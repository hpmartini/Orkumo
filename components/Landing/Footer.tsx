import { motion } from 'framer-motion';
import { Rocket, Github, Twitter, Linkedin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Footer() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  // Check for reduced motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <footer id="contact" className="relative pt-20 pb-8 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Massive Marquee - Respects reduced motion preference */}
      <div className="mb-20 overflow-hidden">
        <motion.div
          animate={
            prefersReducedMotion
              ? {} // No animation if user prefers reduced motion
              : { x: [0, -2000] }
          }
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: 'linear',
            // Add repeatType to prevent memory accumulation
            repeatType: 'loop',
          }}
          className="flex whitespace-nowrap"
          // Force hardware acceleration for better performance
          style={{ willChange: prefersReducedMotion ? 'auto' : 'transform' }}
        >
          {[...Array(3)].map((_, i) => (
            <span
              key={i}
              className="font-heading font-black text-6xl sm:text-7xl md:text-8xl lg:text-9xl text-transparent bg-clip-text bg-gradient-to-r from-electric-blue via-cyber-purple to-electric-blue opacity-10 mx-8"
            >
              LET'S BUILD THE FUTURE • ORCHESTRATE YOUR WORKFLOW • AI-POWERED DEVELOPMENT •
            </span>
          ))}
        </motion.div>
      </div>

      {/* Footer Content */}
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand Column */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-electric-blue blur-xl opacity-20" />
                <Rocket className="w-8 h-8 text-electric-blue relative" />
              </div>
              <span className="font-heading font-bold text-2xl text-white">
                DevOrbit
              </span>
            </div>
            <p className="font-body text-gray-400 text-sm leading-relaxed">
              The AI-first developer dashboard that transforms how you manage local development projects.
            </p>
          </div>

          {/* Links Column */}
          <div>
            <h4 className="font-heading font-bold text-white mb-4">Quick Links</h4>
            <ul className="space-y-2">
              {[
                { label: 'Dashboard', href: '/dashboard' },
                { label: 'Features', href: '#features' },
                { label: 'Why DevOrbit', href: '#why-us' },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="font-body text-gray-400 hover:text-electric-blue transition-colors text-sm"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA Column */}
          <div>
            <h4 className="font-heading font-bold text-white mb-4">Get Started</h4>
            <p className="font-body text-gray-400 text-sm mb-4">
              Ready to transform your development workflow?
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="group relative w-full"
              onClick={() => navigate('/dashboard')}
              aria-label="Navigate to dashboard"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-lg blur-md opacity-75 group-hover:opacity-100 transition-opacity" />
              <div className="relative px-6 py-3 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-lg font-body font-bold text-white text-center">
                Launch Dashboard
              </div>
            </motion.button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-8" />

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-body text-gray-500 text-sm">
            © {currentYear} DevOrbit. Built with AI-first principles.
          </p>

          {/* Social Links - Commented out until actual URLs are available */}
          {/* <div className="flex items-center gap-4">
            {[
              { icon: <Github className="w-5 h-5" />, href: 'https://github.com/yourorg/devorbit', label: 'GitHub' },
              { icon: <Twitter className="w-5 h-5" />, href: 'https://twitter.com/devorbit', label: 'Twitter' },
              { icon: <Linkedin className="w-5 h-5" />, href: 'https://linkedin.com/company/devorbit', label: 'LinkedIn' },
            ].map((social, idx) => (
              <motion.a
                key={idx}
                href={social.href}
                whileHover={{ scale: 1.1, y: -2 }}
                whileTap={{ scale: 0.9 }}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-electric-blue hover:border-electric-blue/50 transition-colors"
                aria-label={`Visit our ${social.label} page`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {social.icon}
              </motion.a>
            ))}
          </div> */}
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-electric-blue/50 to-transparent" />
    </footer>
  );
}
