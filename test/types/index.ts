import multerS3 = require('../../index')

import { S3Client } from '@aws-sdk/client-s3'

import multer = require('multer')

const s3 = new S3Client({})

multerS3({ s3, bucket: 'b' })

const storage = multerS3({
  s3,
  bucket: (req, file, cb) => cb(null, 'b'),
  key: (req, file, cb) => cb(null, file.originalname),
  acl: 'public-read',
  contentType: multerS3.AUTO_CONTENT_TYPE,
  contentDisposition: 'attachment',
  contentEncoding: 'gzip',
  metadata: (req, file, cb) => cb(null, { a: 1 }),
  cacheControl: (req, file, cb) => cb(null, 'max-age=1'),
  storageClass: 'STANDARD',
  serverSideEncryption: 'aws:kms',
  sseKmsKeyId: 'key',
  tagging: 'a=b'
})

multerS3({
  s3,
  bucket: 'b',
  contentType: (req, file, cb) => cb(null, 'text/plain', new Blob(['x']).stream())
})

multer({ storage })

const file: Express.MulterS3.File = null as unknown as Express.MulterS3.File
const key: string = file.key
const versionId: string | undefined = file.versionId
const encoding: string | null = file.contentEncoding

// @ts-expect-error bucket is required
multerS3({ s3 })

// @ts-expect-error s3 is required
multerS3({ bucket: 'b' })

// @ts-expect-error options are required
multerS3()

// @ts-expect-error storageClass must be a string
multerS3({ s3, bucket: 'b', storageClass: 1 })

export { encoding, key, versionId }
