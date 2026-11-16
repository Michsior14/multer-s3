const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const stream = require('node:stream')
const multerS3 = require('../')
const mockS3 = require('./util/mock-s3')
const helpers = require('./util/helpers')

const png = fs.readFileSync(path.join(__dirname, 'files', 'ffffff.png'))

function handleFile(s3, readable) {
  return helpers.handleFile(multerS3({ s3, bucket: 'test', contentType: multerS3.AUTO_CONTENT_TYPE }), readable)
}

function slowChunks(buffer, chunkSize, delay) {
  let offset = 0
  return new stream.Readable({
    read() {
      if (offset >= buffer.length) return this.push(null)
      const chunk = buffer.subarray(offset, offset + chunkSize)
      offset += chunkSize
      setTimeout(() => this.push(chunk), delay)
    }
  })
}

describe('AUTO_CONTENT_TYPE', () => {
  afterEach(() => {
    multerS3._setFileTypeLoader()
  })

  it('uploads every byte of a file delivered in many small chunks', async () => {
    const s3 = mockS3()
    const data = Buffer.concat([png, crypto.randomBytes(200 * 1024)])

    const info = await handleFile(s3, slowChunks(data, 512, 0))

    assert.equal(info.contentType, 'image/png')
    assert.equal(s3.uploads.length, 1)
    assert.ok(s3.uploads[0].body.equals(data))
  })

  it('does not lose data that arrives while the content type is detected', async () => {
    const s3 = mockS3()
    const data = Buffer.concat([png, crypto.randomBytes(64 * 1024)])
    const source = new stream.PassThrough()

    const pending = handleFile(s3, source)
    // Everything is written at once, before and after the sample is complete
    source.write(data.subarray(0, 10))
    source.write(data.subarray(10, 5000))
    source.write(data.subarray(5000))
    source.end()

    const info = await pending
    assert.equal(info.contentType, 'image/png')
    assert.ok(s3.uploads[0].body.equals(data))
  })

  it('completes for an empty file', async () => {
    const s3 = mockS3()
    const info = await handleFile(s3, stream.Readable.from([]))

    assert.equal(info.contentType, 'application/octet-stream')
    assert.equal(s3.uploads[0].body.length, 0)
  })

  it('completes for a file smaller than the detection sample', async () => {
    const s3 = mockS3()
    const info = await handleFile(s3, stream.Readable.from([Buffer.from('abc')]))

    assert.equal(info.contentType, 'application/octet-stream')
    assert.equal(s3.uploads[0].body.toString(), 'abc')
  })

  it('falls back to octet-stream when detection throws', async () => {
    const s3 = mockS3()
    const data = crypto.randomBytes(8192)

    multerS3._setFileTypeLoader(async () => ({
      fileTypeFromBuffer: async () => {
        throw new Error('boom')
      }
    }))

    const info = await handleFile(s3, slowChunks(data, 1024, 0))
    assert.equal(info.contentType, 'application/octet-stream')
    assert.ok(s3.uploads[0].body.equals(data))
  })

  it('reports an error when file-type cannot be loaded', async () => {
    const s3 = mockS3()
    const source = slowChunks(crypto.randomBytes(8192), 1024, 0)

    multerS3._setFileTypeLoader(async () => {
      throw new Error('no esm')
    })

    await assert.rejects(handleFile(s3, source), /Failed to load file-type.*no esm/)
    assert.equal(s3.uploads.length, 0)
  })

  it('does not crash when the source errors while file-type is still loading', async () => {
    const s3 = mockS3()
    const source = new stream.PassThrough()

    multerS3._setFileTypeLoader(() => new Promise((resolve) => setTimeout(() => resolve(import('file-type')), 50)))

    const pending = handleFile(s3, source)
    source.write(crypto.randomBytes(8192))
    setTimeout(() => source.destroy(new Error('boom during detection')), 10)

    await assert.rejects(pending, /boom during detection/)
    assert.equal(s3.uploads.length, 0)
  })

  it('accepts text chunks', async () => {
    const s3 = mockS3()
    const source = stream.Readable.from(['abc', 'def'])
    source.setEncoding('utf8')

    const info = await handleFile(s3, source)
    assert.equal(info.contentType, 'application/octet-stream')
    assert.equal(s3.uploads[0].body.toString(), 'abcdef')
  })

  it('fails when the source is already destroyed', async () => {
    const s3 = mockS3()
    const source = new stream.PassThrough()
    source.on('error', () => {})
    source.destroy(new Error('already gone'))

    await assert.rejects(handleFile(s3, source), /already gone/)
    assert.equal(s3.uploads.length, 0)
  })

  it('fails when the source closes without an error after detection', async () => {
    const s3 = mockS3()
    const source = new stream.PassThrough()
    const pending = handleFile(s3, source)

    source.write(crypto.randomBytes(8192))
    setTimeout(() => source.destroy(), 20)

    await assert.rejects(pending, /closed|premature/i)
    assert.equal(s3.uploads.length, 0)
  })

  it('stops reading from the source when the upload fails', async () => {
    const s3 = mockS3({ fail: { PutObjectCommand: new Error('s3 down') } })
    const source = slowChunks(crypto.randomBytes(8192), 1024, 0)

    await assert.rejects(handleFile(s3, source), /s3 down/)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(source.readableEnded || source.destroyed)
  })

  it('supports opting in to svg detection with a custom contentType', async () => {
    const s3 = mockS3()
    const storage = multerS3({
      s3,
      bucket: 'test',
      contentType: (req, file, cb) =>
        file.originalname.endsWith('.svg') ? cb(null, 'image/svg+xml') : multerS3.AUTO_CONTENT_TYPE(req, file, cb)
    })

    const info = await helpers.handleFile(storage, stream.Readable.from([Buffer.from('<svg/>')]), {
      originalname: 'logo.svg'
    })
    assert.equal(info.contentType, 'image/svg+xml')
    assert.equal(s3.uploads[0].input.ContentType, 'image/svg+xml')
  })

  it('reports an error from the source stream before detection finishes', async () => {
    const s3 = mockS3()
    const source = new stream.PassThrough()
    const pending = handleFile(s3, source)

    source.write(Buffer.from('abc'))
    setTimeout(() => source.destroy(new Error('source failed')), 20)

    await assert.rejects(pending, /source failed|closed/)
    assert.equal(s3.uploads.length, 0)
  })

  it('fails the upload when the source errors after detection', async () => {
    const s3 = mockS3()
    const source = new stream.PassThrough()
    const pending = handleFile(s3, source)

    source.write(crypto.randomBytes(8192))
    setTimeout(() => source.destroy(new Error('source failed')), 20)

    await assert.rejects(pending, /source failed/)
    assert.equal(s3.uploads.length, 0)
  })
})
