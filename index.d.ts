import { ServiceClients } from "@aws-sdk/lib-storage";
import { StorageEngine } from "multer";

interface Options {
  s3: ServiceClients;
  bucket:
    | ((
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error: any, bucket?: string) => void
      ) => void)
    | string;
  key?(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, key?: string) => void
  ): void;
  acl?:
    | ((
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error: any, acl?: string) => void
      ) => void)
    | string;
  contentType?(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (
      error: any,
      mime?: string,
      stream?: NodeJS.ReadableStream
    ) => void
  ): void;
  contentDisposition?:
    | ((
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error: any, contentDisposition?: string) => void
      ) => void)
    | string;
  metadata?(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, metadata?: any) => void
  ): void;
  cacheControl?:
    | ((
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error: any, cacheControl?: string) => void
      ) => void)
    | string;
  serverSideEncryption?:
    | ((
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error: any, serverSideEncryption?: string) => void
      ) => void)
    | string;
}

declare global {
  namespace Express {
    namespace MulterS3 {
      interface File extends Multer.File {
        bucket: string;
        key: string;
        acl: string;
        contentType: string;
        contentDisposition: null;
        storageClass: string;
        serverSideEncryption: null;
        metadata: any;
        location: string;
        etag: string;
      }
    }
  }
}

interface S3Storage {
  (options?: Options): StorageEngine;

  AUTO_CONTENT_TYPE(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (
      error: any,
      mime?: string,
      stream?: NodeJS.ReadableStream
    ) => void
  ): void;
  DEFAULT_CONTENT_TYPE(
    req: Express.Request,
    file: Express.Multer.File,
    callback: (error: any, mime?: string) => void
  ): void;
}

declare const s3Storage: S3Storage;
export = s3Storage;
