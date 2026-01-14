import { motion } from 'framer-motion';
import {
  Zap,
  Bot,
  Database,
  MonitorPlay,
  Workflow,
  ArrowUpRight
} from 'lucide-react';
import { cn } from '../../shared/cn';

interface ServiceCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tech: string;
  gradient: string;
  delay: number;
  size?: 'default' | 'large';
}

function ServiceCard({ icon, title, description, tech, gradient, delay, size = 'default' }: ServiceCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.6, delay }}
      whileHover={{ y: -8, scale: 1.02 }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/10 backdrop-blur-sm transition-all duration-300',
        'hover:border-white/30 hover:shadow-2xl',
        size === 'large' ? 'md:col-span-2' : ''
      )}
    >
      {/* Gradient background */}
      <div className={cn('absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500', gradient)} />

      {/* Card content */}
      <div className="relative p-6 sm:p-8 bg-gray-900/80 group-hover:bg-gray-900/50 transition-colors duration-300 h-full flex flex-col">
        {/* Icon */}
        <div className="mb-4 relative">
          <div className="absolute inset-0 bg-electric-blue blur-xl opacity-0 group-hover:opacity-30 transition-opacity" />
          <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-xl bg-gradient-to-br from-electric-blue/20 to-cyber-purple/20 border border-white/10 group-hover:border-white/30 transition-colors">
            {icon}
          </div>
        </div>

        {/* Title */}
        <h3 className="font-heading font-bold text-xl sm:text-2xl text-white mb-3 group-hover:text-electric-blue transition-colors">
          {title}
        </h3>

        {/* Description */}
        <p className="font-body text-sm sm:text-base text-gray-400 mb-4 leading-relaxed flex-grow">
          {description}
        </p>

        {/* Tech stack badge */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 group-hover:border-electric-blue/50 transition-colors">
            <span className="font-mono text-xs text-electric-blue">{tech}</span>
          </div>
          <ArrowUpRight className="w-5 h-5 text-gray-600 group-hover:text-electric-blue group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
        </div>

        {/* Decorative grid pattern */}
        <div className="absolute top-0 right-0 w-32 h-32 opacity-5 group-hover:opacity-10 transition-opacity">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            </pattern>
            <rect width="100" height="100" fill="url(#grid)" />
          </svg>
        </div>
      </div>
    </motion.div>
  );
}

export function Services() {
  const services = [
    {
      icon: <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-electric-blue" />,
      title: 'Real-Time Monitoring',
      description: 'Track CPU, memory, and port usage across all your development projects in real-time with intelligent alerts.',
      tech: 'React + WebSocket',
      gradient: 'bg-gradient-to-br from-electric-blue/10 to-transparent',
      size: 'default' as const,
    },
    {
      icon: <Bot className="w-6 h-6 sm:w-7 sm:h-7 text-cyber-purple" />,
      title: 'AI Project Analysis',
      description: 'Gemini AI automatically analyzes your project configs, suggests optimizations, and provides smart recommendations for improvements.',
      tech: 'Gemini AI / LangChain',
      gradient: 'bg-gradient-to-br from-cyber-purple/10 to-transparent',
      size: 'large' as const,
    },
    {
      icon: <Database className="w-6 h-6 sm:w-7 sm:h-7 text-acid-green" />,
      title: 'Multi-Project Orchestration',
      description: 'Start, stop, and restart multiple services with one click. Group projects by directory for seamless management.',
      tech: 'Node.js + Process Manager',
      gradient: 'bg-gradient-to-br from-acid-green/10 to-transparent',
      size: 'large' as const,
    },
    {
      icon: <MonitorPlay className="w-6 h-6 sm:w-7 sm:h-7 text-electric-blue" />,
      title: 'Integrated Terminal',
      description: 'Full-featured web terminal with multiple tabs, live output streaming, and support for custom shells.',
      tech: 'xterm.js + node-pty',
      gradient: 'bg-gradient-to-br from-electric-blue/10 to-transparent',
      size: 'default' as const,
    },
    {
      icon: <Workflow className="w-6 h-6 sm:w-7 sm:h-7 text-cyber-purple" />,
      title: 'Docker Support',
      description: 'Detect and manage Docker containers alongside your regular projects with unified controls.',
      tech: 'Docker API + Compose',
      gradient: 'bg-gradient-to-br from-cyber-purple/10 to-transparent',
      size: 'default' as const,
    },
  ];

  return (
    <section id="features" className="relative py-20 sm:py-32 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-black text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white mb-6 tracking-tight">
            Built for
            <span className="bg-gradient-to-r from-electric-blue to-cyber-purple bg-clip-text text-transparent"> Modern Developers</span>
          </h2>
          <p className="font-body text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            Everything you need to monitor, manage, and optimize your development workflow.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {services.map((service, idx) => (
            <ServiceCard
              key={service.title}
              {...service}
              delay={0.1 + idx * 0.1}
            />
          ))}
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute top-1/2 left-0 w-64 h-64 bg-electric-blue/10 rounded-full blur-[128px]" />
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-cyber-purple/10 rounded-full blur-[128px]" />
    </section>
  );
}
