import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Hero() {
  const navigate = useNavigate();
  return (
    <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Content */}
      <div className="max-w-6xl mx-auto text-center relative z-10 pt-20">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full bg-gradient-to-r from-electric-blue/10 to-cyber-purple/10 border border-electric-blue/20 backdrop-blur-sm"
        >
          <Sparkles className="w-4 h-4 text-electric-blue" />
          <span className="font-body text-sm font-medium text-gray-200">
            AI-First Developer Dashboard
          </span>
        </motion.div>

        {/* Main Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="font-heading font-black text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl tracking-tight mb-6 leading-[0.95]"
        >
          <span className="text-white">Orchestrate Your</span>
          <br />
          <span className="bg-gradient-to-r from-electric-blue via-cyber-purple to-electric-blue bg-clip-text text-transparent animate-gradient">
            Dev Ecosystem
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="font-body font-light text-lg sm:text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-12 leading-relaxed"
        >
          Monitor, manage, and optimize your local development projects with
          <span className="text-electric-blue font-medium"> AI-powered insights</span>.
          <br className="hidden sm:block" />
          One dashboard to rule them all.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6"
        >
          {/* Primary CTA */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group relative w-full sm:w-auto"
            onClick={() => navigate('/dashboard')}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-xl blur-xl opacity-75 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-xl font-body font-bold text-base sm:text-lg text-white shadow-2xl shadow-electric-blue/50">
              Launch Dashboard
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.button>

          {/* Secondary CTA */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group relative w-full sm:w-auto"
            onClick={() => {
              const element = document.getElementById('features');
              element?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <div className="absolute inset-0 bg-white/5 rounded-xl" />
            <div className="relative flex items-center justify-center gap-2 px-8 py-4 bg-transparent border-2 border-white/20 rounded-xl font-body font-semibold text-base sm:text-lg text-white backdrop-blur-sm group-hover:border-white/40 transition-colors">
              Explore Features
            </div>
          </motion.button>
        </motion.div>

        {/* Floating Stats */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-20 grid grid-cols-3 gap-4 sm:gap-8 max-w-2xl mx-auto"
        >
          {[
            { label: 'Projects Managed', value: '100+' },
            { label: 'AI Analyses', value: '1K+' },
            { label: 'Active Devs', value: '500+' },
          ].map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6 + idx * 0.1 }}
              className="relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-electric-blue/10 to-cyber-purple/10 rounded-lg blur-md group-hover:blur-lg transition-all" />
              <div className="relative p-4 backdrop-blur-sm border border-white/10 rounded-lg group-hover:border-white/20 transition-colors">
                <div className="font-heading font-black text-2xl sm:text-3xl md:text-4xl text-white mb-1">
                  {stat.value}
                </div>
                <div className="font-body text-xs sm:text-sm text-gray-400">
                  {stat.label}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Gradient orbs for atmosphere */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-electric-blue/20 rounded-full blur-[128px] animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyber-purple/20 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '1s' }} />
    </section>
  );
}
