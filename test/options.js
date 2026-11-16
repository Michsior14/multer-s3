const assert = require('node:assert')
const stream = require('node:stream')
const multer = require('multer')
const FormData = require('form-data')
const multerS3 = require('../')
const mockS3 = require('./util/mock-s3')
const { handleFile, submit } = require('./util/helpers')

const body = () => stream.Readable.from([Buffer.from('hello')])

describe('Options', () => {
  describe('validation', () => {
    const cases = [
      ['s3 missing', { s3: undefined }, TypeError, /opts\.s3/],
      ['s3 null', { s3: null }, TypeError, /opts\.s3/],
      ['bucket missing', { bucket: undefined }, Error, /bucket is required/],
      ['bucket number', { bucket: 1 }, TypeError, /opts\.bucket/]
    ]

    ;[
      'acl',
      'cacheControl',
      'contentDisposition',
      'contentEncoding',
      'storageClass',
      'serverSideEncryption',
      'sseKmsKeyId',
      'tagging'
    ].forEach((name) => {
      cases.push([
        `${name} number`,
        { [name]: 1 },
        TypeError,
        new RegExp(`opts\\.${name} to be undefined, string or function`)
      ])
      cases.push([`${name} object`, { [name]: {} }, TypeError, new RegExp(`opts\\.${name}`)])
    })

    ;['key', 'contentType', 'metadata'].forEach((name) => {
      cases.push([
        `${name} string`,
        { [name]: 'x' },
        TypeError,
        new RegExp(`opts\\.${name} to be undefined or function`)
      ])
      cases.push([`${name} number`, { [name]: 1 }, TypeError, new RegExp(`opts\\.${name}`)])
    })

    cases.forEach(([title, override, errorType, message]) => {
      it(`throws for ${title}`, () => {
        assert.throws(
          () => multerS3(Object.assign({ s3: mockS3(), bucket: 'test' }, override)),
          (err) => err instanceof errorType && message.test(err.message)
        )
      })
    })

    it('accepts every option as a function', () => {
      const fn = (req, file, cb) => cb(null, 'x')
      multerS3({
        s3: mockS3(),
        bucket: fn,
        key: fn,
        acl: fn,
        contentType: fn,
        metadata: fn,
        cacheControl: fn,
        contentDisposition: fn,
        contentEncoding: fn,
        storageClass: fn,
        serverSideEncryption: fn,
        sseKmsKeyId: fn,
        tagging: fn
      })
    })
  })

  describe('request sent to S3', () => {
    it('maps static options', async () => {
      const s3 = mockS3()
      const storage = multerS3({
        s3,
        bucket: 'my-bucket',
        key: (req, file, cb) => cb(null, 'my/key.txt'),
        acl: 'public-read',
        cacheControl: 'max-age=1',
        contentDisposition: 'attachment',
        contentEncoding: 'gzip',
        storageClass: 'GLACIER',
        serverSideEncryption: 'aws:kms',
        sseKmsKeyId: 'kms-key',
        tagging: 'a=b&c=d',
        metadata: (req, file, cb) => cb(null, { field: file.fieldname }),
        contentType: (req, file, cb) => cb(null, 'text/plain')
      })

      const info = await handleFile(storage, body())
      const input = s3.uploads[0].input

      assert.equal(input.Bucket, 'my-bucket')
      assert.equal(input.Key, 'my/key.txt')
      assert.equal(input.ACL, 'public-read')
      assert.equal(input.CacheControl, 'max-age=1')
      assert.equal(input.ContentDisposition, 'attachment')
      assert.equal(input.ContentEncoding, 'gzip')
      assert.equal(input.StorageClass, 'GLACIER')
      assert.equal(input.ServerSideEncryption, 'aws:kms')
      assert.equal(input.SSEKMSKeyId, 'kms-key')
      assert.equal(input.Tagging, 'a=b&c=d')
      assert.equal(input.ContentType, 'text/plain')
      assert.deepEqual(input.Metadata, { field: 'file' })

      assert.equal(info.key, 'my/key.txt')
      assert.equal(info.tagging, 'a=b&c=d')
      assert.equal(info.storageClass, 'GLACIER')
      assert.equal(info.contentEncoding, 'gzip')
      assert.equal(info.contentDisposition, 'attachment')
      assert.equal(info.size, 5)
    })

    it('maps options given as functions', async () => {
      const s3 = mockS3()
      const value = (result) => (req, file, cb) => cb(null, result)
      const storage = multerS3({
        s3,
        bucket: value('fn-bucket'),
        acl: value('private'),
        cacheControl: value('no-cache'),
        contentDisposition: value('inline'),
        contentEncoding: value('br'),
        storageClass: value('STANDARD_IA'),
        serverSideEncryption: value('AES256'),
        tagging: value('x=y')
      })

      await handleFile(storage, body())
      const input = s3.uploads[0].input

      assert.equal(input.Bucket, 'fn-bucket')
      assert.equal(input.CacheControl, 'no-cache')
      assert.equal(input.ContentDisposition, 'inline')
      assert.equal(input.ContentEncoding, 'br')
      assert.equal(input.StorageClass, 'STANDARD_IA')
      assert.equal(input.ServerSideEncryption, 'AES256')
      assert.equal(input.Tagging, 'x=y')
    })

    it('uses defaults and omits optional headers', async () => {
      const s3 = mockS3()
      await handleFile(multerS3({ s3, bucket: 'test' }), body())
      const input = s3.uploads[0].input

      assert.equal(input.ACL, 'private')
      assert.equal(input.StorageClass, 'STANDARD')
      assert.equal(input.ContentType, 'application/octet-stream')
      assert.ok(!('ContentDisposition' in input))
      assert.ok(!('ContentEncoding' in input))
      assert.ok(!('Tagging' in input))
    })

    it('generates a random 32 character hex key by default', async () => {
      const s3 = mockS3()
      const storage = multerS3({ s3, bucket: 'test' })

      const first = await handleFile(storage, body())
      const second = await handleFile(storage, body())

      assert.match(first.key, /^[0-9a-f]{32}$/)
      assert.match(second.key, /^[0-9a-f]{32}$/)
      assert.notEqual(first.key, second.key)
    })

    it('uses the replacement stream returned by a custom contentType', async () => {
      const s3 = mockS3()
      const storage = multerS3({
        s3,
        bucket: 'test',
        contentType: (req, file, cb) => cb(null, 'text/plain', stream.Readable.from([Buffer.from('replaced')]))
      })

      await handleFile(storage, body())
      assert.equal(s3.uploads[0].body.toString(), 'replaced')
    })
  })

  describe('errors', () => {
    ;['bucket', 'key', 'acl', 'metadata', 'contentType', 'tagging'].forEach((name) => {
      it(`fails without calling S3 when ${name} calls back with an error`, async () => {
        const s3 = mockS3()
        const storage = multerS3({ s3, bucket: 'test', [name]: (req, file, cb) => cb(new Error(`callback ${name}`)) })

        await assert.rejects(handleFile(storage, body()), new RegExp(`callback ${name}`))
        assert.equal(s3.commands.length, 0)
      })

      it(`fails without calling S3 when ${name} throws`, async () => {
        const s3 = mockS3()
        const storage = multerS3({
          s3,
          bucket: 'test',
          [name]: () => {
            throw new Error(`thrown ${name}`)
          }
        })

        await assert.rejects(handleFile(storage, body()), new RegExp(`thrown ${name}`))
        assert.equal(s3.commands.length, 0)
      })
    })

    it('reports a failing S3 upload when a custom contentType returns a web stream', async () => {
      const s3 = mockS3({ fail: { PutObjectCommand: new Error('s3 down') } })
      const storage = multerS3({
        s3,
        bucket: 'test',
        contentType: (req, file, cb) => cb(null, 'text/plain', new Blob(['hello']).stream())
      })

      await assert.rejects(handleFile(storage, body()), /s3 down/)
    })

    it('reports a failing S3 upload', async () => {
      const s3 = mockS3({ fail: { PutObjectCommand: new Error('s3 down') } })

      await assert.rejects(handleFile(multerS3({ s3, bucket: 'test' }), body()), /s3 down/)
    })
  })

  describe('multer integration', () => {
    it('uploads multiple files independently', async () => {
      const s3 = mockS3()
      const upload = multer({ storage: multerS3({ s3, bucket: 'test' }) })
      const form = new FormData()

      form.append('photos', Buffer.from('first'), 'a.txt')
      form.append('photos', Buffer.from('second file'), 'b.txt')
      form.append('photos', Buffer.from('3'), 'c.txt')

      const { err, req } = await submit(upload.array('photos', 3), form)
      assert.ifError(err)

      assert.equal(req.files.length, 3)
      assert.deepEqual(
        req.files.map((f) => f.size),
        [5, 11, 1]
      )
      assert.equal(new Set(req.files.map((f) => f.key)).size, 3)

      const stored = new Map(s3.uploads.map((u) => [u.input.Key, u.body.toString()]))
      req.files.forEach((file, index) => {
        assert.equal(stored.get(file.key), ['first', 'second file', '3'][index])
      })
    })

    it('removes uploaded files when multer aborts the request', async () => {
      const s3 = mockS3()
      const upload = multer({
        storage: multerS3({ s3, bucket: 'test', key: (req, file, cb) => cb(null, file.originalname) }),
        limits: { fileSize: 10 }
      })
      const form = new FormData()

      form.append('photos', Buffer.from('small'), 'small.txt')
      form.append('photos', Buffer.alloc(100), 'big.txt')

      const { err } = await submit(upload.array('photos', 2), form)
      assert.equal(err.code, 'LIMIT_FILE_SIZE')

      const deletes = s3.commands.filter((c) => c.name === 'DeleteObjectCommand')
      assert.ok(deletes.some((c) => c.input.Bucket === 'test' && c.input.Key === 'small.txt'))
    })
  })

  describe('_removeFile', () => {
    it('sends DeleteObject with bucket and key', (done) => {
      const s3 = mockS3()
      const storage = multerS3({ s3, bucket: 'test' })

      storage._removeFile({}, { bucket: 'b', key: 'k' }, (err) => {
        assert.ifError(err)
        assert.deepEqual(
          s3.commands.map((c) => [c.name, c.input]),
          [['DeleteObjectCommand', { Bucket: 'b', Key: 'k' }]]
        )
        done()
      })
    })

    it('passes S3 errors to the callback', (done) => {
      const s3 = mockS3({ fail: { DeleteObjectCommand: new Error('delete failed') } })

      multerS3({ s3, bucket: 'test' })._removeFile({}, { bucket: 'b', key: 'k' }, (err) => {
        assert.equal(err.message, 'delete failed')
        done()
      })
    })
  })
})
