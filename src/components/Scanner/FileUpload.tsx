import { useRef, useState, type DragEvent } from 'react';

interface FileUploadProps {
  onFilesSelect: (files: File[]) => void;
  multiple?: boolean;
}

export default function FileUpload({ onFilesSelect, multiple = true }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const validFiles = Array.from(e.dataTransfer.files).filter(isValidFile);
    if (validFiles.length > 0) {
      onFilesSelect(validFiles);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const validFiles = Array.from(e.target.files || []).filter(isValidFile);
    if (validFiles.length > 0) {
      onFilesSelect(validFiles);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const isValidFile = (file: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      return false;
    }
    if (file.size > 20 * 1024 * 1024) {
      return false;
    }
    return true;
  };

  return (
    <div
      className={`file-upload ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        multiple={multiple}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <div className="upload-content">
        <div className="upload-icon">+</div>
        <p className="upload-text">Drop invoices here or click to browse</p>
        <p className="upload-hint">Supports JPG, PNG, PDF (max 20MB each) — select multiple files</p>
      </div>
    </div>
  );
}
