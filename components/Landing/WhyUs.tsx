import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';

export function WhyUs() {
  const comparisons = [
    {
      old: 'Manually checking each project terminal',
      new: 'Real-time unified dashboard view',
    },
    {
      old: 'Hunting for free ports manually',
      new: 'Automatic port conflict detection',
    },
    {
      old: 'Reading docs to figure out start commands',
      new: 'AI analyzes and configures automatically',
    },
    {
      old: 'Switching between multiple terminal windows',
      new: 'Integrated multi-tab web terminal',
    },
    {
      old: 'Forgetting which services are running',
      new: 'Visual status tracking with alerts',
    },
  ];

  return (
    <section id="why-us" className="relative py-20 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-black text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white mb-6 tracking-tight">
            The
            <span className="bg-gradient-to-r from-electric-blue to-cyber-purple bg-clip-text text-transparent"> AI-First </span>
            Difference
          </h2>
          <p className="font-body text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            Stop context-switching. Start building faster.
          </p>
        </motion.div>

        {/* Comparison Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          {/* Old Way */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="sticky top-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                  <X className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="font-heading font-bold text-2xl text-gray-400">
                  The Old Way
                </h3>
              </div>
              <div className="space-y-4">
                {comparisons.map((item, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 + idx * 0.1 }}
                    className="group p-4 rounded-lg bg-gray-900/50 border border-red-500/20 backdrop-blur-sm"
                  >
                    <div className="flex items-start gap-3">
                      <X className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="font-body text-gray-400 line-through">
                        {item.old}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* New Way */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="sticky top-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-electric-blue blur-xl opacity-30" />
                  <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-electric-blue to-cyber-purple flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                </div>
                <h3 className="font-heading font-bold text-2xl text-white">
                  The DevOrbit Way
                </h3>
              </div>
              <div className="space-y-4">
                {comparisons.map((item, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 + idx * 0.1 }}
                    className="group p-4 rounded-lg bg-gradient-to-br from-electric-blue/5 to-cyber-purple/5 border border-electric-blue/30 backdrop-blur-sm hover:border-electric-blue/60 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-electric-blue flex-shrink-0 mt-0.5" />
                      <p className="font-body text-white font-medium">
                        {item.new}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-16 text-center"
        >
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group relative inline-block"
            onClick={() => window.location.href = '/dashboard'}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-xl blur-xl opacity-75 group-hover:opacity-100 transition-opacity" />
            <div className="relative px-8 py-4 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-xl font-body font-bold text-lg text-white shadow-2xl">
              Experience the Future
            </div>
          </motion.button>
        </motion.div>
      </div>

      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-electric-blue/5 rounded-full blur-[128px]" />
    </section>
  );
}
