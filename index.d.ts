import { S3Client } from '@aws-sdk/client-s3'
import { StorageEngine } from 'multer'

type Callback<T> = (error: any, value?: T) => void

type Option<T> = T | ((req: Express.Request, file: Express.Multer.File, callback: Callback<T>) => void)

interface Options {
  s3: S3Client
  bucket: Option<string>
  key?(req: Express.Request, file: Express.Multer.File, callback: Callback<string>): void
  acl?: Option<string>
  contentType?(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, mime?: string, stream?: NodeJS.ReadableStream | ReadableStream) => void
  ): void
  contentDisposition?: Option<string>
  contentEncoding?: Option<string>
  metadata?(req: Express.Request, file: Express.Multer.File, callback: Callback<any>): void
  cacheControl?: Option<string>
  storageClass?: Option<string>
  serverSideEncryption?: Option<string>
  sseKmsKeyId?: Option<string>
  tagging?: Option<string>
}

declare global {
  namespace Express {
    namespace MulterS3 {
      interface File extends Multer.File {
        bucket: string
        key: string
        acl: string
        contentType: string
        contentDisposition: string | null
        contentEncoding: string | null
        storageClass: string
        serverSideEncryption: string | null
        metadata: any
        location: string
        etag: string
        versionId?: string
        tagging?: string
      }
    }
  }
}

interface S3Storage {
  (options: Options): StorageEngine

  AUTO_CONTENT_TYPE(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, mime?: string, stream?: NodeJS.ReadableStream) => void
  ): void
  DEFAULT_CONTENT_TYPE(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, mime?: string) => void
  ): void
}

declare const s3Storage: S3Storage
export = s3Storage
