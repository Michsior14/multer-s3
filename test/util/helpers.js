const stream = require('node:stream')
const onFinished = require('on-finished')

function handleFile(storage, readable, file) {
  return new Promise((resolve, reject) => {
    storage._handleFile(
      {},
      Object.assign({ fieldname: 'file', originalname: 'file', stream: readable }, file),
      (err, info) => {
        if (err) reject(err)
        else resolve(info)
      }
    )
  })
}

function submitForm(multer, form, cb) {
  form.getLength((err, length) => {
    if (err) return cb(err)

    const req = new stream.PassThrough()

    req.complete = false
    form.once('end', () => {
      req.complete = true
    })

    form.pipe(req)
    req.headers = {
      'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
      'content-length': length
    }

    multer(req, null, (err) => {
      onFinished(req, () => {
        cb(err, req)
      })
    })
  })
}

function submit(multer, form) {
  return new Promise((resolve) => {
    submitForm(multer, form, (err, req) => {
      resolve({ err, req })
    })
  })
}

module.exports = { handleFile, submitForm, submit }
