const PDF_MAGIC = Buffer.from('%PDF-');

function hasPdfMagic(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PDF_MAGIC.length
    && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

function rejectUnlessPdfMagic(req, res, file = req.file) {
  if (!file || !hasPdfMagic(file.buffer)) {
    res.status(400).json({ error: 'File is not a valid PDF' });
    return false;
  }
  return true;
}

// Multer's fileFilter error otherwise becomes a generic 500. Callers should
// answer with the same sentence the drop zone shows.
function rejectNonPdfUpload(upload, field = 'pdf') {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File must be under 10MB' });
      }
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    });
  };
}

module.exports = { PDF_MAGIC, hasPdfMagic, rejectUnlessPdfMagic, rejectNonPdfUpload };
