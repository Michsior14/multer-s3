# Multer S3

Streaming multer storage engine for AWS S3.

This project is mostly an integration piece for existing code samples from Multer's [storage engine documentation](https://github.com/expressjs/multer/blob/master/StorageEngine.md) with [s3fs](https://github.com/RiptideElements/s3fs) as the substitution piece for file system. Existing solutions I found required buffering the multipart uploads into the actual filesystem which is difficult to scale.

## Installation

```sh
npm install --save @michaukrieg/multer-s3 @aws-sdk/client-s3 @aws-sdk/lib-storage
```

Requires Node.js 22 or newer and AWS SDK v3. (Version 4 supports older Node.js versions.)

### Breaking changes in v5

- Requires Node.js 22 or newer.
- `AUTO_CONTENT_TYPE` no longer guesses `image/svg+xml` from the file content, see [Detecting SVG](#detecting-svg).
- `AUTO_CONTENT_TYPE` loads `file-type` with a dynamic `import()`, which fails under Jest unless it runs with `--experimental-vm-modules`.

## Usage

```javascript
const { S3Client } = require('@aws-sdk/client-s3')
const express = require('express')
const multer = require('multer')
const multerS3 = require('@michaukrieg/multer-s3')

const app = express()
const s3 = new S3Client({
  /* ... */
})

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname })
    },
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})

app.post('/upload', upload.array('photos', 3), function (req, res, next) {
  res.send('Successfully uploaded ' + req.files.length + ' files!')
})
```

### File information

Each file contains the following information exposed by `multer-s3`:

| Key                    | Description                                                                | Note        |
| ---------------------- | -------------------------------------------------------------------------- | ----------- |
| `size`                 | Size of the file in bytes                                                  |
| `bucket`               | The bucket used to store the file                                          | `S3Storage` |
| `key`                  | The name of the file                                                       | `S3Storage` |
| `acl`                  | Access control for the file                                                | `S3Storage` |
| `contentType`          | The `mimetype` used to upload the file                                     | `S3Storage` |
| `metadata`             | The `metadata` object to be sent to S3                                     | `S3Storage` |
| `location`             | The S3 `url` to access the file                                            | `S3Storage` |
| `etag`                 | The `etag`of the uploaded file in S3                                       | `S3Storage` |
| `contentDisposition`   | The `contentDisposition` used to upload the file                           | `S3Storage` |
| `storageClass`         | The `storageClass` to be used for the uploaded file in S3                  | `S3Storage` |
| `versionId`            | The `versionId` is an optional param returned by S3 for versioned buckets. | `S3Storage` |
| `contentEncoding`      | The `contentEncoding` used to upload the file                              | `S3Storage` |
| `serverSideEncryption` | The server-side encryption used for the file                               | `S3Storage` |
| `tagging`              | The `tagging` string sent to S3                                            | `S3Storage` |

### Setting ACL

[ACL values](http://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl) can be set by passing an optional `acl` parameter into the `multerS3` object.

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    acl: 'public-read',
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```

Available options for canned ACL.

| ACL Option                  | Permissions added to ACL                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private`                   | Owner gets `FULL_CONTROL`. No one else has access rights (default).                                                                                         |
| `public-read`               | Owner gets `FULL_CONTROL`. The `AllUsers` group gets `READ` access.                                                                                         |
| `public-read-write`         | Owner gets `FULL_CONTROL`. The `AllUsers` group gets `READ` and `WRITE` access. Granting this on a bucket is generally not recommended.                     |
| `aws-exec-read`             | Owner gets `FULL_CONTROL`. Amazon EC2 gets `READ` access to `GET` an Amazon Machine Image (AMI) bundle from Amazon S3.                                      |
| `authenticated-read`        | Owner gets `FULL_CONTROL`. The `AuthenticatedUsers` group gets `READ` access.                                                                               |
| `bucket-owner-read`         | Object owner gets `FULL_CONTROL`. Bucket owner gets `READ` access. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it.             |
| `bucket-owner-full-control` | Both the object owner and the bucket owner get `FULL_CONTROL` over the object. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it. |
| `log-delivery-write`        | The `LogDelivery` group gets `WRITE` and `READ_ACP` permissions on the bucket. For more information on logs.                                                |

### Object keys

If no `key` function is given, a random 32 character hex string is used as the key.

## Setting Metadata

The `metadata` option is a callback that accepts the request and file, and returns a metadata object to be saved to S3.

Here is an example that stores all fields in the request body as metadata, and uses an `id` param as the key:

```javascript
const opts = {
  s3: s3,
  bucket: config.originalsBucket,
  metadata: function (req, file, cb) {
    cb(null, Object.assign({}, req.body))
  },
  key: function (req, file, cb) {
    cb(null, req.params.id + '.jpg')
  }
}
```

## Setting Cache-Control header

The optional `cacheControl` option sets the `Cache-Control` HTTP header that will be sent if you're serving the files directly from S3. You can pass either a string or a function that returns a string.

Here is an example that will tell browsers and CDNs to cache the file for one year:

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    cacheControl: 'max-age=31536000',
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```

## Setting Custom Content-Type

The optional `contentType` option can be used to set Content/mime type of the file. By default the content type is set to `application/octet-stream`. If you want multer-s3 to automatically find the content-type of the file, use the `multerS3.AUTO_CONTENT_TYPE` constant. Here is an example that will detect the content type of the file being uploaded.

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```
You may also use a function as the `contentType`, which should be of the form `function(req, file, cb)`.

With `AUTO_CONTENT_TYPE` the first ~4 KB of the file are buffered to detect the type with [file-type](https://github.com/sindresorhus/file-type), and the file is then streamed to S3 without any data loss. If nothing is detected or detection fails, `application/octet-stream` is used.

`file-type` is loaded with a dynamic `import()`. If that is not possible (for example Jest without `--experimental-vm-modules`), the upload fails with an explanatory error instead of silently using the default type.

### Detecting SVG

Text based formats such as SVG have no signature, so they are not detected (an SVG starting with `<?xml` is reported as `application/xml`). Versions before 5 guessed `image/svg+xml` from the content. If you need it, decide yourself and fall back to the detection:

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    contentType: function (req, file, cb) {
      if (file.originalname.toLowerCase().endsWith('.svg')) return cb(null, 'image/svg+xml')
      multerS3.AUTO_CONTENT_TYPE(req, file, cb)
    }
  })
})
```

**Note:** browsers execute scripts inside SVG and XML files opened directly. When serving user uploads, use a separate domain or the `contentDisposition: 'attachment'` option.

## Setting StorageClass

[storageClass values](https://aws.amazon.com/s3/storage-classes/) can be set by passing an optional `storageClass` parameter into the `multerS3` object.

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    acl: 'public-read',
    storageClass: 'STANDARD_IA',
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```

## Setting Content-Disposition

The optional `contentDisposition` option can be used to set the `Content-Disposition` header for the uploaded file. By default, the `contentDisposition` isn't forwarded. As an example below, using the value `attachment` forces the browser to download the uploaded file instead of trying to open it.

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    acl: 'public-read',
    contentDisposition: 'attachment',
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```

## Using Server-Side Encryption

_An overview of S3's server-side encryption can be found in the [S3 Docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/serv-side-encryption.html); be advised that customer-managed keys (SSE-C) is not implemented at this time._

You may use the S3 server-side encryption functionality via the optional `serverSideEncryption` and `sseKmsKeyId` parameters. Full documentation of these parameters in relation to the S3 API can be found [here](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/PutObjectCommand/) and [here](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html).

`serverSideEncryption` has two valid values: 'AES256' and 'aws:kms'. 'AES256' utilizes the S3-managed key system, while 'aws:kms' utilizes the AWS KMS system and accepts the optional `sseKmsKeyId` parameter to specify the key ID of the key you wish to use. Leaving `sseKmsKeyId` blank when 'aws:kms' is specified will use the default KMS key. **Note:** _The specified key must be in the same AWS region as the S3 bucket used._

```javascript
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'some-bucket',
    acl: 'authenticated-read',
    contentDisposition: 'attachment',
    serverSideEncryption: 'AES256',
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })
})
```

## Setting Content-Encoding

The optional `contentEncoding` option (string or function) sets the `Content-Encoding` header of the uploaded file, e.g. `'gzip'`.

## Setting Tagging

The optional `tagging` option (string or function) sets the object tags, in URL query format, e.g. `'key1=value1&key2=value2'`.

## Testing

The tests mock all access to S3 and can be run completely offline.

```sh
npm test
```
