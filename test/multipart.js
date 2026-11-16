const assert = require('node:assert')
const crypto = require('node:crypto')
const stream = require('node:stream')
const multerS3 = require('../')
const mockS3 = require('./util/mock-s3')
const { handleFile } = require('./util/helpers')

const MB = 1024 * 1024

function chunked(buffer, size) {
  const chunks = []
  for (let i = 0; i < buffer.length; i += size) chunks.push(buffer.subarray(i, i + size))
  return stream.Readable.from(chunks)
}

describe('Large (multipart) uploads', function () {
  this.timeout(30000)

  it('uploads a 12 MB file in parts without corrupting it', async () => {
    const s3 = mockS3()
    const data = crypto.randomBytes(12 * MB)

    const info = await handleFile(multerS3({ s3, bucket: 'test' }), chunked(data, 64 * 1024))

    assert.equal(s3.uploads.length, 1)
    assert.ok(s3.uploads[0].partCount > 1)
    assert.ok(s3.uploads[0].body.equals(data))
    assert.equal(info.size, data.length)
    assert.equal(info.etag, 'mock-multipart-etag')
    assert.equal(info.location, `https://s3.mock/test/${info.key}`)
  })

  it('keeps all bytes with AUTO_CONTENT_TYPE on a large png', async () => {
    const s3 = mockS3()
    const png = require('node:fs').readFileSync(require('node:path').join(__dirname, 'files', 'ffffff.png'))
    const data = Buffer.concat([png, crypto.randomBytes(11 * MB)])

    const info = await handleFile(
      multerS3({ s3, bucket: 'test', contentType: multerS3.AUTO_CONTENT_TYPE }),
      chunked(data, 100 * 1024)
    )

    assert.equal(info.contentType, 'image/png')
    assert.equal(s3.uploads[0].input.ContentType, 'image/png')
    assert.ok(s3.uploads[0].body.equals(data))
    assert.equal(info.size, data.length)
  })

  it('reports a failing part upload', async () => {
    const s3 = mockS3({ fail: { UploadPartCommand: new Error('part failed') } })

    await assert.rejects(
      handleFile(multerS3({ s3, bucket: 'test' }), chunked(crypto.randomBytes(12 * MB), 64 * 1024)),
      /part failed/
    )
    assert.ok(s3.commands.some((c) => c.name === 'AbortMultipartUploadCommand'))
  })
})
