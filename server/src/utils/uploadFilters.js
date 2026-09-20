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

module.exports = { PDF_MAGIC, hasPdfMagic, rejectUnlessPdfMagic };
