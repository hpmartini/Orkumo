import { useState, useRef, useEffect, type ReactNode, type CSSProperties } from 'react';

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  /** Delay in ms before showing tooltip (default: 250) */
  delay?: number;
  /** Position of tooltip relative to children */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional class for the tooltip */
  className?: string;
  /** Whether tooltip is disabled */
  disabled?: boolean;
}

export function Tooltip({
  children,
  content,
  delay = 250,
  position = 'top',
  className = '',
  disabled = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const showTooltip = () => {
    if (disabled || !content) return;

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  // Position tooltip when it becomes visible
  useEffect(() => {
    if (!isVisible || !triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const gap = 8; // Gap between trigger and tooltip

    let top: number;
    let left: number;

    switch (position) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - gap;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + gap;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + gap;
        break;
    }

    // Ensure tooltip stays within viewport
    const padding = 8;
    if (left < padding) left = padding;
    if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipRect.height > window.innerHeight - padding) {
      top = window.innerHeight - tooltipRect.height - padding;
    }

    setTooltipStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
    });
  }, [isVisible, position]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`
            z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900
            rounded shadow-lg border border-gray-700
            animate-fade-in pointer-events-none whitespace-nowrap
            ${className}
          `}
          style={tooltipStyle}
        >
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * Tooltip specifically for showing keyboard shortcuts
 */
interface ShortcutTooltipProps {
  children: ReactNode;
  label: string;
  shortcut?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  disabled?: boolean;
}

export function ShortcutTooltip({
  children,
  label,
  shortcut,
  position = 'top',
  disabled = false,
}: ShortcutTooltipProps) {
  const content = shortcut ? (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-800 rounded border border-gray-600">
        {shortcut}
      </kbd>
    </span>
  ) : (
    label
  );

  return (
    <Tooltip content={content} position={position} disabled={disabled}>
      {children}
    </Tooltip>
  );
}
