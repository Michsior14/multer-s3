async function readBody(body) {
  if (body === undefined || body === null) return Buffer.alloc(0)
  if (typeof body === 'string' || ArrayBuffer.isView(body)) return Buffer.from(body)

  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

// Minimal in-memory S3 client: supports single and multipart uploads and deletes.
// Pass { fail: { CommandName: error } } to make commands fail.
function createMockS3(options = {}) {
  const fail = options.fail || {}
  const commands = []
  const uploads = []
  const parts = new Map()
  let nextUploadId = 1

  async function send(command) {
    const name = command.constructor.name
    const input = command.input
    commands.push({ name, input })

    if (fail[name]) throw fail[name]

    switch (name) {
      case 'PutObjectCommand': {
        const body = await readBody(input.Body)
        uploads.push({ input, body })
        return { ETag: 'mock-etag' }
      }
      case 'CreateMultipartUploadCommand': {
        const uploadId = `upload-${nextUploadId++}`
        parts.set(uploadId, { input, parts: new Map() })
        return { UploadId: uploadId }
      }
      case 'UploadPartCommand': {
        const body = await readBody(input.Body)
        parts.get(input.UploadId).parts.set(input.PartNumber, body)
        return { ETag: `part-etag-${input.PartNumber}` }
      }
      case 'CompleteMultipartUploadCommand': {
        const upload = parts.get(input.UploadId)
        const numbers = input.MultipartUpload.Parts.map((part) => part.PartNumber)
        const body = Buffer.concat(numbers.map((number) => upload.parts.get(number)))
        uploads.push({ input: upload.input, body, partCount: numbers.length })
        return { ETag: 'mock-multipart-etag', Location: `https://s3.mock/${input.Bucket}/${input.Key}` }
      }
      default:
        return {}
    }
  }

  return {
    send,
    commands,
    uploads,
    config: {
      endpoint: async () => ({ protocol: 'https:', hostname: 's3.mock', path: '/' }),
      forcePathStyle: true,
      requestHandler: {},
      requestChecksumCalculation: async () => 'WHEN_REQUIRED'
    }
  }
}

module.exports = createMockS3
