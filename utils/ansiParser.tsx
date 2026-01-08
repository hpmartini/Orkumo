import React from 'react';

/**
 * ANSI color code to Tailwind CSS class mappings
 */
const ANSI_COLORS: Record<number, string> = {
  // Standard foreground colors
  30: 'text-gray-900',      // Black
  31: 'text-red-500',       // Red
  32: 'text-green-500',     // Green
  33: 'text-yellow-500',    // Yellow
  34: 'text-blue-500',      // Blue
  35: 'text-purple-500',    // Magenta
  36: 'text-cyan-500',      // Cyan
  37: 'text-gray-200',      // White
  39: 'text-gray-300',      // Default

  // Bright foreground colors
  90: 'text-gray-500',      // Bright Black (Gray)
  91: 'text-red-400',       // Bright Red
  92: 'text-green-400',     // Bright Green
  93: 'text-yellow-400',    // Bright Yellow
  94: 'text-blue-400',      // Bright Blue
  95: 'text-purple-400',    // Bright Magenta
  96: 'text-cyan-400',      // Bright Cyan
  97: 'text-white',         // Bright White
};

const ANSI_BG_COLORS: Record<number, string> = {
  // Standard background colors
  40: 'bg-gray-900',        // Black
  41: 'bg-red-900',         // Red
  42: 'bg-green-900',       // Green
  43: 'bg-yellow-900',      // Yellow
  44: 'bg-blue-900',        // Blue
  45: 'bg-purple-900',      // Magenta
  46: 'bg-cyan-900',        // Cyan
  47: 'bg-gray-100',        // White
  49: '',                   // Default (no bg)

  // Bright background colors
  100: 'bg-gray-700',       // Bright Black
  101: 'bg-red-800',        // Bright Red
  102: 'bg-green-800',      // Bright Green
  103: 'bg-yellow-800',     // Bright Yellow
  104: 'bg-blue-800',       // Bright Blue
  105: 'bg-purple-800',     // Bright Magenta
  106: 'bg-cyan-800',       // Bright Cyan
  107: 'bg-gray-200',       // Bright White
};

interface TextSegment {
  text: string;
  classes: string[];
}

/**
 * Parse ANSI escape codes and return styled React elements
 */
export function parseAnsiToReact(text: string, key: string | number): React.ReactNode {
  // Regular expression to match ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let currentClasses: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        classes: [...currentClasses],
      });
    }

    // Parse the escape codes
    const codes = match[1].split(';').map(Number).filter(n => !isNaN(n));

    for (const code of codes) {
      if (code === 0) {
        // Reset all styles
        currentClasses = [];
      } else if (code === 1) {
        // Bold
        currentClasses.push('font-bold');
      } else if (code === 2) {
        // Dim
        currentClasses.push('opacity-60');
      } else if (code === 3) {
        // Italic
        currentClasses.push('italic');
      } else if (code === 4) {
        // Underline
        currentClasses.push('underline');
      } else if (code === 7) {
        // Inverse - swap fg/bg (simplified)
        currentClasses.push('bg-gray-200 text-gray-900');
      } else if (code === 9) {
        // Strikethrough
        currentClasses.push('line-through');
      } else if (code >= 30 && code <= 37) {
        // Standard foreground colors
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
        currentClasses.push(ANSI_COLORS[code] || 'text-gray-300');
      } else if (code === 39) {
        // Default foreground
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
      } else if (code >= 40 && code <= 47) {
        // Standard background colors
        currentClasses = currentClasses.filter(c => !c.startsWith('bg-'));
        if (ANSI_BG_COLORS[code]) {
          currentClasses.push(ANSI_BG_COLORS[code]);
        }
      } else if (code === 49) {
        // Default background
        currentClasses = currentClasses.filter(c => !c.startsWith('bg-'));
      } else if (code >= 90 && code <= 97) {
        // Bright foreground colors
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
        currentClasses.push(ANSI_COLORS[code] || 'text-gray-300');
      } else if (code >= 100 && code <= 107) {
        // Bright background colors
        currentClasses = currentClasses.filter(c => !c.startsWith('bg-'));
        if (ANSI_BG_COLORS[code]) {
          currentClasses.push(ANSI_BG_COLORS[code]);
        }
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      classes: [...currentClasses],
    });
  }

  // If no segments, return plain text
  if (segments.length === 0) {
    return <span key={key}>{text}</span>;
  }

  // Render segments
  return (
    <span key={key}>
      {segments.map((segment, idx) => (
        <span key={idx} className={segment.classes.join(' ')}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
