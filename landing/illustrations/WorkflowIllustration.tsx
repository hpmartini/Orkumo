import { WORKFLOW } from '../copy';

const NODES = [
  { name: 'Plan', x: 60, state: 'done' },
  { name: 'Build', x: 170, state: 'done' },
  { name: 'Gates', x: 280, state: 'done' },
  { name: 'Review', x: 390, state: 'active' },
  { name: 'Check', x: 500, state: 'next' },
] as const;

const BOX_W = 88;
const BOX_H = 40;
const BOX_Y = 34;
const CENTER_Y = 54;

const STATE_COLOR = {
  done: '#34d399',
  active: '#3b82f6',
  next: '#a8bbe2',
} as const;

/** the live workflow graph of an orchestrated run */
export function WorkflowIllustration() {
  return (
    <div className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Workflow</span>
        <span className="label-tape text-muted">{WORKFLOW.illustrationLabel}</span>
      </div>
      <div className="p-4">
        <svg
          viewBox="0 0 560 220"
          role="img"
          aria-label="Workflow graph: Plan, Build, Gates, Review and Check. Review is the active step; a fix round leads back to Build and a goal loop back to Plan."
          className="block w-full"
        >
          {/* steps */}
          {NODES.map((node, i) => {
            const next = NODES[i + 1];
            return (
              <g key={node.name}>
                {next && (
                  <path
                    d={`M ${node.x + BOX_W / 2} ${CENTER_Y} L ${next.x - BOX_W / 2} ${CENTER_Y}`}
                    stroke="#34497a"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}

          {/* return edges under the axis */}
          <path
            d="M 390 74 V 100 L 370 120 H 190 L 170 100 V 74"
            fill="none"
            stroke="#a78bfa"
            strokeWidth={1.5}
            opacity={0.75}
          />
          <path
            d="M 500 74 V 150 L 480 170 H 80 L 60 150 V 74"
            fill="none"
            stroke="#a78bfa"
            strokeWidth={1.5}
            opacity={0.45}
          />
          <text x={280} y={112} textAnchor="middle" fontSize={13} fill="#a8bbe2">
            fix round
          </text>
          <text x={280} y={162} textAnchor="middle" fontSize={13} fill="#a8bbe2">
            goal loop
          </text>

          {/* nodes */}
          {NODES.map((node) => (
            <g key={node.name}>
              {node.state === 'active' && (
                <rect
                  x={node.x - BOX_W / 2 - 5}
                  y={BOX_Y - 5}
                  width={BOX_W + 10}
                  height={BOX_H + 10}
                  rx={9}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  opacity={0.4}
                />
              )}
              <rect
                x={node.x - BOX_W / 2}
                y={BOX_Y}
                width={BOX_W}
                height={BOX_H}
                rx={6}
                fill="#1e2c50"
                stroke={node.state === 'active' ? '#3b82f6' : '#34497a'}
                strokeWidth={node.state === 'active' ? 2 : 1}
              />
              <rect
                x={node.x - BOX_W / 2 + 9}
                y={BOX_Y + 9}
                width={8}
                height={8}
                rx={2}
                fill={STATE_COLOR[node.state]}
                opacity={node.state === 'next' ? 0.55 : 1}
              />
              <text
                x={node.x + 5}
                y={CENTER_Y + 5}
                textAnchor="middle"
                fontSize={15}
                fontWeight={600}
                fill={node.state === 'active' ? '#e8eefa' : '#a8bbe2'}
              >
                {node.name}
              </text>
            </g>
          ))}

          {/* the GO button, part of the picture */}
          <rect x={456} y={186} width={88} height={30} rx={5} fill="#2563eb" />
          <text x={500} y={206} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
            GO
          </text>
        </svg>
      </div>
    </div>
  );
}
