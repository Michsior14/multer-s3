const multerS3 = require('../')

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')
const multer = require('multer')
const FormData = require('form-data')
const mockS3 = require('./util/mock-s3')
const { submitForm } = require('./util/helpers')

const VALID_OPTIONS = {
  bucket: 'string'
}

const INVALID_OPTIONS = [
  ['numeric key', { key: 1337 }],
  ['string key', { key: 'string' }],
  ['numeric bucket', { bucket: 1337 }],
  ['numeric contentType', { contentType: 1337 }]
]

describe('Multer S3', () => {
  it('is exposed as a function', () => {
    assert.equal(typeof multerS3, 'function')
  })

  INVALID_OPTIONS.forEach((testCase) => {
    it(`throws when given ${testCase[0]}`, () => {
      function testBody() {
        multerS3(Object.assign({}, VALID_OPTIONS, testCase[1]))
      }

      assert.throws(testBody, TypeError)
    })
  })

  it('upload files', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({ s3, bucket: 'test' })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'ffffff.png'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.originalname, 'ffffff.png')
      assert.equal(req.file.size, 68)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))

      done()
    })
  })

  it('uploads file with AES256 server-side encryption', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({ s3, bucket: 'test', serverSideEncryption: 'AES256' })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'ffffff.png'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.originalname, 'ffffff.png')
      assert.equal(req.file.size, 68)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'AES256')

      done()
    })
  })

  it('uploads file with AWS KMS-managed server-side encryption', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({ s3, bucket: 'test', serverSideEncryption: 'aws:kms' })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'ffffff.png'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.originalname, 'ffffff.png')
      assert.equal(req.file.size, 68)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'aws:kms')

      done()
    })
  })

  it('uploads PNG file with correct content-type', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({
      s3,
      bucket: 'test',
      serverSideEncryption: 'aws:kms',
      contentType: multerS3.AUTO_CONTENT_TYPE
    })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'ffffff.png'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.contentType, 'image/png')
      assert.equal(req.file.originalname, 'ffffff.png')
      assert.equal(req.file.size, 68)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'aws:kms')

      done()
    })
  })

  it('does not detect an svg without xml prolog as svg', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({
      s3,
      bucket: 'test',
      serverSideEncryption: 'aws:kms',
      contentType: multerS3.AUTO_CONTENT_TYPE
    })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'test.svg'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.contentType, 'application/octet-stream')
      assert.equal(req.file.originalname, 'test.svg')
      assert.equal(req.file.size, 100)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'aws:kms')

      done()
    })
  })

  it('detects an svg with xml prolog as generic xml', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({
      s3,
      bucket: 'test',
      serverSideEncryption: 'aws:kms',
      contentType: multerS3.AUTO_CONTENT_TYPE
    })
    const upload = multer({ storage })
    const parser = upload.single('image')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'test2.svg'))

    form.append('name', 'Multer')
    form.append('image', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')

      assert.equal(req.file.fieldname, 'image')
      assert.equal(req.file.contentType, 'application/xml')
      assert.equal(req.file.originalname, 'test2.svg')
      assert.equal(req.file.size, 285)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'aws:kms')

      done()
    })
  })

  it('uploads common file as gzip content encoded', (done) => {
    const s3 = mockS3()
    const form = new FormData()
    const storage = multerS3({
      s3,
      bucket: 'test',
      serverSideEncryption: 'aws:kms',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      contentEncoding: 'gzip'
    })
    const upload = multer({ storage })
    const parser = upload.single('file')
    const image = fs.createReadStream(path.join(__dirname, 'files', 'a.txt'))

    form.append('name', 'Multer')
    form.append('file', image)

    submitForm(parser, form, (err, req) => {
      assert.ifError(err)

      assert.equal(req.body.name, 'Multer')
      assert.equal(req.file.fieldname, 'file')
      assert.equal(req.file.contentType, 'application/octet-stream')
      assert.equal(req.file.originalname, 'a.txt')
      assert.equal(req.file.size, 7)
      assert.equal(req.file.bucket, 'test')
      assert.equal(req.file.etag, 'mock-etag')
      assert.ok(req.file.location.startsWith('https://s3.mock/test/'))
      assert.equal(req.file.serverSideEncryption, 'aws:kms')
      assert.equal(req.file.contentEncoding, 'gzip')
      done()
    })
  })
})
