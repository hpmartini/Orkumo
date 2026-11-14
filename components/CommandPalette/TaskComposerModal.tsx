import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { DispatchInput } from '../AgentsView/DispatchInput';
import { NewKindTabs, type NewKind } from '../AgentsView/NewTaskButton';
import { useDialogA11y } from './useDialogA11y';
import { ImageAttachments, imageDropHandlers } from '../ImageAttachments';
import { attachableFiles } from '../../utils/composer';

type DispatchInputProps = React.ComponentProps<typeof DispatchInput>;

interface TaskComposerModalProps extends Omit<DispatchInputProps, 'onEscape' | 'attachments'> {
  open: boolean;
  onClose: () => void;
  /** Images handed to the session as local file paths */
  images: File[];
  onImagesChange: (images: File[]) => void;
  /** Shows the Task/Agent/Chat/Issue switch (#271) */
  onKindChange?: (kind: NewKind) => void;
}

/** "New task" / "New agent" dialog around the dispatch input. */
export const TaskComposerModal: React.FC<TaskComposerModalProps> = ({
  open,
  onClose,
  images,
  onImagesChange,
  onKindChange,
  ...inputProps
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogA11y(open, dialogRef, () => inputProps.inputRef.current);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-composer-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          // The textarea closes its own suggestions first and marks the event handled
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        {...imageDropHandlers((files) => onImagesChange([...images, ...files]), attachableFiles)}
        className="w-full max-w-[680px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <div className="flex items-center mb-3">
          <h2 id="task-composer-title" className="text-sm font-semibold text-gray-50">
            {inputProps.variant === 'chat'
              ? 'New chat'
              : inputProps.variant === 'agent'
                ? 'New agent'
                : 'New task'}
          </h2>
          {onKindChange && (
            <div className="ml-3">
              <NewKindTabs
                kind={inputProps.variant ?? 'task'}
                onChange={onKindChange}
                disabled={inputProps.disabled}
              />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 rounded-md text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <DispatchInput
          {...inputProps}
          onEscape={onClose}
          attachments={
            <ImageAttachments
              images={images}
              onChange={onImagesChange}
              disabled={inputProps.disabled}
              files
              note={images.length ? 'Stays local, handed to the agent by path' : undefined}
            />
          }
        />
      </div>
    </div>
  );
};
