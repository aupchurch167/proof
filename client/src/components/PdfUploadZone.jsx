import { useState, useRef, useId } from 'react';
import { useToast } from '../contexts/ToastContext';

export default function PdfUploadZone({
  onUpload,
  onFileSelect,
  loading = false,
  error = null,
  accept = '.pdf',
  multiple = false,
  maxSizeMB = 10,
  label,
  sublabel,
  sizeLabel,
  buttonLabel = 'Upload COI',
  loadingMessage,
}) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const inputId = useId();

  const validateFile = (file) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const acceptExts = accept.split(',').map(a => a.trim().replace('.', ''));
    if (!acceptExts.includes(ext)) {
      return `Only ${accept} files are allowed`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `File size must be less than ${maxSizeMB}MB`;
    }
    return null;
  };

  const handleFiles = (newFiles) => {
    const validFiles = [];
    for (const file of newFiles) {
      const err = validateFile(file);
      if (err) {
        toast.error(err);
      } else {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) return;

    if (onFileSelect) {
      // Parent manages state — report new files, keep drop zone ready
      onFileSelect(multiple ? validFiles : validFiles[0]);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!multiple) {
        setFiles([validFiles[0]]);
      }
    } else {
      // Internal state management (original behavior)
      if (multiple) {
        setFiles(prev => [...prev, ...validFiles]);
      } else {
        setFiles([validFiles[0]]);
      }
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length) handleFiles(droppedFiles);
  };

  const handleInputChange = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length) handleFiles(selected);
  };

  const removeFile = (index) => {
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
  };

  const handleUploadClick = async () => {
    if (files.length === 0 || !onUpload) return;
    await onUpload(multiple ? files : files[0]);
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const file = files[0];
  const hasFiles = files.length > 0;
  const isPdf = accept.includes('.pdf');
  const defaultLabel = isPdf ? 'Drag and drop your PDF here' : 'Drag and drop your CSV here';
  const defaultSublabel = 'or click to select a file';
  const defaultSizeLabel = `Max ${maxSizeMB}MB, ${accept.replace(/\./g, '').toUpperCase()} only`;
  const defaultLoadingMsg = `We're processing your file${multiple ? 's' : ''}. This may take a moment...`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control text-sm">
          {error}
        </div>
      )}

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-card p-6 sm:p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-info-bg'
            : hasFiles && !onFileSelect
            ? 'border-line-strong bg-card-alt'
            : 'border-line-strong hover:border-blue-400'
        } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
          id={inputId}
          disabled={loading}
        />
        <label htmlFor={inputId} className="cursor-pointer">
          {!multiple && file && !onFileSelect ? (
            <div>
              <div className="w-12 h-12 bg-info-bg rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6 text-navy"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="font-medium text-ink">{file.name}</p>
              <p className="text-sm text-muted mt-1">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <p className="text-xs text-navy mt-2 hover:underline">
                Click to change file
              </p>
            </div>
          ) : !multiple && file && onFileSelect ? (
            <div>
              <div className="w-12 h-12 bg-info-bg rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6 text-navy"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="font-medium text-ink">{file.name}</p>
              <p className="text-sm text-muted mt-1">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <p className="text-xs text-navy mt-2 hover:underline">
                Click to change file
              </p>
            </div>
          ) : (
            <div>
              <svg
                className="w-12 h-12 text-faint mx-auto mb-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-muted font-medium">
                {label || defaultLabel}
              </p>
              <p className="text-sm text-muted mt-1">
                {sublabel || defaultSublabel}
              </p>
              <p className="text-xs text-faint mt-2">
                {sizeLabel || defaultSizeLabel}
              </p>
            </div>
          )}
        </label>
      </div>

      {/* Multi-file list (only when managing state internally) */}
      {multiple && !onFileSelect && hasFiles && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-card-alt px-4 py-2 rounded-control border">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-ink-2">{f.name}</p>
                  <p className="text-xs text-faint">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <button onClick={() => removeFile(i)} className="text-faint hover:text-bad-text">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {onUpload && hasFiles && (
        <button
          onClick={handleUploadClick}
          disabled={loading}
          className="w-full bg-amber text-white py-3 rounded-control hover:bg-amber-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {loading ? 'Uploading & Analyzing...' : buttonLabel}
        </button>
      )}

      {loading && (
        <p className="text-sm text-muted text-center">
          {loadingMessage || defaultLoadingMsg}
        </p>
      )}
    </div>
  );
}
