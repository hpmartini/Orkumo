import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, ImagePlus, Paperclip, X } from 'lucide-react';
import { ATTACHMENT_EXTENSIONS } from '../config/limits.js';
import { PROMPT_IMAGE_TYPES, attachableFiles, imageFiles } from '../utils/composer';

type Pick = (list: FileList | File[] | null | undefined) => File[];

/**
 * Paste / drop handlers for a composer dialog; spread them on the dialog element so a paste
 * into any of its fields adds the images (`pick` = attachableFiles: also PDF, text and code).
 */
export function imageDropHandlers(onAdd: (files: File[]) => void, pick: Pick = imageFiles) {
  return {
    onPaste: (e: React.ClipboardEvent) => {
      const files = pick(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      onAdd(files);
    },
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const files = pick(e.dataTransfer.files);
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
  /** Also PDF, text and code files (agent prompts, #19 AK-3); issues take images only */
  files?: boolean;
}

const FILE_ACCEPT = [...PROMPT_IMAGE_TYPES, ...ATTACHMENT_EXTENSIONS.map((e) => `.${e}`)].join(',');

/** Thumbnails of the attached images, chips of attached files, plus a file picker */
export const ImageAttachments: React.FC<ImageAttachmentsProps> = ({
  images,
  onChange,
  disabled,
  note,
  files = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useMemo(
    () => images.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [images]
  );
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const remove = (file: File, i: number) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(images.filter((_, j) => j !== i))}
      className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-gray-900 border border-gray-600 text-gray-200 hover:text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-blue-400"
      aria-label={`Remove ${file.name || `attachment ${i + 1}`}`}
    >
      <X size={11} />
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {images.map((file, i) => {
        const url = urls[i];
        return url ? (
          <div key={url} className="relative group">
            <img
              src={url}
              alt={file.name || `Image ${i + 1}`}
              className="h-14 w-14 object-cover rounded-md border border-gray-600"
            />
            {remove(file, i)}
          </div>
        ) : (
          <div
            key={`${file.name}-${i}`}
            className="relative flex items-center gap-1.5 h-9 max-w-[14rem] pl-2 pr-3 rounded-md border border-gray-600 bg-gray-900 text-xs text-gray-200"
            title={file.name}
          >
            <FileText size={13} className="shrink-0 text-gray-400" aria-hidden />
            <span className="truncate">{file.name}</span>
            {remove(file, i)}
          </div>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
        title={
          files
            ? 'Attach images, PDF, text or code files up to 20 MB (or paste / drop them)'
            : 'Attach images (or paste / drop them)'
        }
      >
        {files ? <Paperclip size={13} aria-hidden /> : <ImagePlus size={13} aria-hidden />}
        {files ? 'Attach' : 'Add image'}
      </button>
      {note && <span className="text-[11px] text-gray-400">{note}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={files ? FILE_ACCEPT : 'image/png,image/jpeg,image/gif,image/webp'}
        multiple
        hidden
        data-testid="attachment-input"
        onChange={(e) => {
          onChange([...images, ...(files ? attachableFiles : imageFiles)(e.target.files)]);
          e.target.value = '';
        }}
      />
    </div>
  );
};
