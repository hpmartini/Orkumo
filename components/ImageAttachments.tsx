import React, { useEffect, useMemo, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { imageFiles } from '../utils/composer';

/**
 * Paste / drop handlers for a composer dialog; spread them on the dialog element so a paste
 * into any of its fields adds the images.
 */
export function imageDropHandlers(onAdd: (files: File[]) => void) {
  return {
    onPaste: (e: React.ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      onAdd(files);
    },
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const files = imageFiles(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();
      onAdd(files);
    },
  };
}

interface ImageAttachmentsProps {
  images: File[];
  onChange: (images: File[]) => void;
  disabled?: boolean;
  /** Shown next to the button, e.g. where the images end up */
  note?: string;
}

/** Thumbnails of the attached images plus a file picker */
export const ImageAttachments: React.FC<ImageAttachmentsProps> = ({
  images,
  onChange,
  disabled,
  note,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => images.map((f) => URL.createObjectURL(f)), [images]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {images.map((file, i) => (
        <div key={urls[i]} className="relative group">
          <img
            src={urls[i]}
            alt={file.name || `Image ${i + 1}`}
            className="h-14 w-14 object-cover rounded-md border border-gray-600"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(images.filter((_, j) => j !== i))}
            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-gray-900 border border-gray-600 text-gray-200 hover:text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label={`Remove ${file.name || `image ${i + 1}`}`}
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
        title="Attach images (or paste / drop them)"
      >
        <ImagePlus size={13} aria-hidden /> Add image
      </button>
      {note && <span className="text-[11px] text-gray-400">{note}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          onChange([...images, ...imageFiles(e.target.files)]);
          e.target.value = '';
        }}
      />
    </div>
  );
};
