import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ChevronLeft, ChevronRight, Pencil, FolderTree } from 'lucide-react';
import type { ProjectContext } from '../types';
import { contextRoot, groupByRoot } from '../utils/projectDirs';

/** Whether the tabs cluster by project directory */
const GROUP_KEY = 'devOrbitContextTabsGrouped';

function loadGrouped(): boolean {
  try {
    return localStorage.getItem(GROUP_KEY) === '1';
  } catch {
    return false; // unavailable storage: ungrouped
  }
}

interface ContextTabsProps {
  contexts: ProjectContext[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** New order of all context ids */
  onReorder: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
  /** Projects and configured project directories, to cluster contexts by directory */
  apps: { id: string; path: string }[];
  projectDirs: string[];
}

/** Project contexts (#97) as tabs in the title bar: click switches, drag sorts, double-click edits */
export const ContextTabs: React.FC<ContextTabsProps> = ({
  contexts,
  activeId,
  onSelect,
  onReorder,
  onEdit,
  onCreate,
  apps,
  projectDirs,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [grouped, setGrouped] = useState(loadGrouped);

  const toggleGrouped = () => {
    const next = !grouped;
    setGrouped(next);
    try {
      localStorage.setItem(GROUP_KEY, next ? '1' : '0');
    } catch {
      // stays in memory only
    }
  };

  /** Tabs in display order; `label` starts a directory cluster. Contexts without one ("Alle") lead. */
  const entries = useMemo(() => {
    const indexed = contexts.map((context, index) => ({ context, index }));
    if (!grouped) return indexed.map((e) => ({ ...e, label: null as string | null }));
    const groups = groupByRoot(
      indexed,
      (e) => contextRoot(e.context.appIds, apps, projectDirs),
      projectDirs
    );
    const other = groups.filter((g) => g.root === null);
    return [...other, ...groups.filter((g) => g.root !== null)].flatMap((g) =>
      g.items.map((e, i) => ({ ...e, label: i === 0 ? g.root : null }))
    );
  }, [contexts, grouped, apps, projectDirs]);

  const updateScrollState = () => {
    if (containerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    }
  };

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [contexts]);

  const scroll = (direction: 'left' | 'right') => {
    containerRef.current?.scrollBy({
      left: direction === 'left' ? -200 : 200,
      behavior: 'smooth',
    });
    setTimeout(updateScrollState, 300);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      const ids = contexts.map((c) => c.id);
      const [moved] = ids.splice(draggedIndex, 1);
      ids.splice(toIndex, 0, moved);
      onReorder(ids);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex items-center bg-gray-900 h-10" role="tablist" aria-label="Kontexte">
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="px-1 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"
          aria-label="Kontexte nach links scrollen"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={containerRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-hide"
        onScroll={updateScrollState}
      >
        {entries.map(({ context, index, label }) => {
          const isActive = activeId === context.id;
          return (
            <React.Fragment key={context.id}>
              {label && (
                <span
                  className="flex items-center h-10 px-2 shrink-0 border-r border-gray-800 text-[10px] font-medium uppercase tracking-wide text-gray-500"
                  title={label}
                >
                  {label.split('/').filter(Boolean).pop()}
                </span>
              )}
              <div
                draggable={!grouped}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelect(context.id)}
                onDoubleClick={() => onEdit(context.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(context.id);
                  }
                }}
                className={`group relative flex items-center gap-2 px-3 h-10 min-w-[120px] max-w-[220px] cursor-pointer border-r border-gray-800 shrink-0 transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-900 text-gray-400 hover:bg-gray-850 hover:text-gray-200'
                } ${draggedIndex === index ? 'opacity-50' : ''} ${
                  dragOverIndex === index ? 'bg-blue-900/30' : ''
                }`}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                title={index < 9 ? `${context.name} (⌘${index + 1})` : context.name}
              >
                {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />}

                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-blue-400' : 'bg-gray-500'}`}
                />

                <span className="truncate text-sm flex-1">{context.name}</span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(context.id);
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-gray-700 text-gray-500 hover:text-white transition-all"
                  aria-label={`Kontext ${context.name} bearbeiten`}
                >
                  <Pencil size={12} />
                </button>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="px-1 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"
          aria-label="Kontexte nach rechts scrollen"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <button
        onClick={toggleGrouped}
        className={`px-2 h-full hover:bg-gray-800 hover:text-white shrink-0 border-l border-gray-800 ${
          grouped ? 'text-blue-400' : 'text-gray-400'
        }`}
        aria-label="Kontexte nach Projektverzeichnis gruppieren"
        aria-pressed={grouped}
        title="Nach Projektverzeichnis gruppieren"
      >
        <FolderTree size={16} />
      </button>

      <button
        onClick={onCreate}
        className="px-2 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0 border-l border-gray-800"
        aria-label="Neuer Kontext"
        title="Neuer Kontext"
      >
        <Plus size={16} />
      </button>
    </div>
  );
};
