const crypto = require('node:crypto')
const stream = require('node:stream')
const util = require('node:util')
const { Upload } = require('@aws-sdk/lib-storage')
const { DeleteObjectCommand } = require('@aws-sdk/client-s3')

const DEFAULT_MIME = 'application/octet-stream'
// Number of bytes collected before the content type is detected (file-type's recommended sample size)
const SAMPLE_SIZE = 4100
// Upper bound of the bytes handed to file-type
const MAX_DETECTION_SIZE = 64 * 1024

function staticValue(value) {
  return (req, file, cb) => {
    cb(null, value)
  }
}

const defaultAcl = staticValue('private')
const defaultContentType = staticValue(DEFAULT_MIME)
const defaultStorageClass = staticValue('STANDARD')

function defaultKey(req, file, cb) {
  crypto.randomBytes(16, (err, raw) => {
    cb(err, err ? undefined : raw.toString('hex'))
  })
}

const importFileType = () => import('file-type')
let fileTypeLoader = importFileType
let fileTypePromise

function loadFileType() {
  // file-type is ESM only, so it has to be imported dynamically
  if (!fileTypePromise) {
    fileTypePromise = Promise.resolve()
      .then(fileTypeLoader)
      .catch((err) => {
        fileTypePromise = undefined
        const error = new Error(
          'Failed to load file-type, required by AUTO_CONTENT_TYPE (when using Jest, run it with --experimental-vm-modules): ' +
            err.message
        )
        error.cause = err
        throw error
      })
  }
  return fileTypePromise
}

// Never rejects: any detection failure results in the default mime type
async function detectMime(fileType, buffered) {
  try {
    const type = await fileType.fileTypeFromBuffer(buffered.subarray(0, MAX_DETECTION_SIZE))
    return type ? type.mime : DEFAULT_MIME
  } catch (_err) {
    return DEFAULT_MIME
  }
}

function autoContentType(req, file, cb) {
  const source = file.stream
  const chunks = []
  let length = 0
  let detecting = false
  let sourceError
  let outStream

  function onData(chunk) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    chunks.push(buffer)
    length += buffer.length
    // Stop reading until the replacement stream is attached, so no data is lost
    if (length >= SAMPLE_SIZE) detect(false)
  }

  function detect(ended) {
    detecting = true
    source.pause()
    source.removeListener('data', onData)
    const buffered = Buffer.concat(chunks, length)
    chunks.length = 0

    // detectMime never rejects, so only a failure to load file-type ends up in the error handler
    loadFileType()
      .then((fileType) => detectMime(fileType, buffered))
      .then(
        (mime) => process.nextTick(done, null, mime),
        (err) => process.nextTick(done, err)
      )

    function done(err, mime) {
      if (err || sourceError) {
        // Drain the file, so the parser is not left blocked
        source.resume()
        return cb(err || sourceError)
      }

      // The listener is needed because the stream is not read until the upload starts,
      // the error itself still reaches the reader
      outStream = new stream.PassThrough().on('error', () => {})
      outStream.write(buffered)
      if (ended) outStream.end()
      else source.pipe(outStream)

      cb(null, mime, outStream)
    }
  }

  // Also reports a stream that was closed before (e.g. while the other options were resolved),
  // and keeps an error listener on the source for as long as it is used
  stream.finished(source, (err) => {
    if (outStream) {
      // pipe() doesn't forward errors or premature closes
      if (err) outStream.destroy(err)
    } else if (detecting) {
      sourceError = err
    } else {
      source.removeListener('data', onData)
      if (err) cb(err)
      else detect(true)
    }
  })

  source.on('data', onData)
}

// [option, property of the storage, accepts a static string, default]
const OPTIONS = [
  ['bucket', 'getBucket', true],
  ['key', 'getKey', false, defaultKey],
  ['acl', 'getAcl', true, defaultAcl],
  ['metadata', 'getMetadata', false, staticValue(undefined)],
  ['cacheControl', 'getCacheControl', true, staticValue(null)],
  ['contentDisposition', 'getContentDisposition', true, staticValue(null)],
  ['contentEncoding', 'getContentEncoding', true, staticValue(null)],
  ['storageClass', 'getStorageClass', true, defaultStorageClass],
  ['serverSideEncryption', 'getSSE', true, staticValue(null)],
  ['sseKmsKeyId', 'getSSEKMS', true, staticValue(null)],
  ['tagging', 'getTagging', true, staticValue(undefined)]
]

function collect(storage, req, file, cb) {
  Promise.all(OPTIONS.map(([, property]) => util.promisify(storage[property]).call(storage, req, file)))
    .then((values) => {
      const opts = Object.fromEntries(OPTIONS.map(([name], index) => [name, values[index]]))

      return new Promise((resolve, reject) => {
        storage.getContentType(req, file, (err, contentType, replacementStream) => {
          if (err) reject(err)
          else resolve({ ...opts, contentType, replacementStream })
        })
      })
    })
    .then(
      (opts) => process.nextTick(cb, null, opts),
      (err) => process.nextTick(cb, err)
    )
}

// Resolves an option that can be a function, optionally a static string, or a default
function getter(opts, name, string, fallback) {
  const value = opts[name]

  if (typeof value === 'function') return value
  if (string && typeof value === 'string') return staticValue(value)
  if (typeof value === 'undefined') return fallback

  throw new TypeError(
    `Expected opts.${name} to be ${string ? 'undefined, string or function' : 'undefined or function'}`
  )
}

function S3Storage(opts) {
  if (typeof opts.s3 !== 'object' || opts.s3 === null) {
    throw new TypeError('Expected opts.s3 to be object')
  }
  this.s3 = opts.s3

  if (typeof opts.bucket === 'undefined') throw new Error('bucket is required')

  for (const [name, property, string, fallback] of OPTIONS) {
    this[property] = getter(opts, name, string, fallback)
  }
  this.getContentType = getter(opts, 'contentType', false, defaultContentType)
}

S3Storage.prototype._handleFile = function (req, file, cb) {
  collect(this, req, file, (err, opts) => {
    if (err) return cb(err)

    let currentSize = 0

    const params = {
      Bucket: opts.bucket,
      Key: opts.key,
      ACL: opts.acl,
      CacheControl: opts.cacheControl,
      ContentType: opts.contentType,
      Metadata: opts.metadata,
      StorageClass: opts.storageClass,
      ServerSideEncryption: opts.serverSideEncryption,
      SSEKMSKeyId: opts.sseKmsKeyId,
      Body: opts.replacementStream || file.stream
    }

    if (opts.contentDisposition) {
      params.ContentDisposition = opts.contentDisposition
    }

    if (opts.contentEncoding) {
      params.ContentEncoding = opts.contentEncoding
    }

    if (opts.tagging) {
      params.Tagging = opts.tagging
    }

    const upload = new Upload({
      client: this.s3,
      params
    })

    upload.on('httpUploadProgress', (ev) => {
      currentSize = ev.total || ev.loaded || currentSize
    })

    util.callbackify(upload.done.bind(upload))((err, result) => {
      if (err) {
        // Don't leave the source blocked on a stream nobody reads anymore
        if (opts.replacementStream) {
          // web streams have no destroy()
          opts.replacementStream.destroy?.()
          file.stream.resume()
        }
        return cb(err)
      }

      cb(null, {
        size: currentSize,
        bucket: opts.bucket,
        key: opts.key,
        acl: opts.acl,
        contentType: opts.contentType,
        contentDisposition: opts.contentDisposition,
        contentEncoding: opts.contentEncoding,
        storageClass: opts.storageClass,
        serverSideEncryption: opts.serverSideEncryption,
        metadata: opts.metadata,
        location: result.Location,
        etag: result.ETag,
        versionId: result.VersionId,
        tagging: opts.tagging
      })
    })
  })
}

S3Storage.prototype._removeFile = function (req, file, cb) {
  util.callbackify(() => this.s3.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.key })))(cb)
}

module.exports = (opts) => new S3Storage(opts)

module.exports.AUTO_CONTENT_TYPE = autoContentType
module.exports.DEFAULT_CONTENT_TYPE = defaultContentType

// Test hook: replaces how file-type is loaded, call without arguments to restore the default
module.exports._setFileTypeLoader = (loader) => {
  fileTypeLoader = loader || importFileType
  fileTypePromise = undefined
}
