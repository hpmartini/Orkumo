import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Rocket, Menu, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/utils/cn';

export function Navbar() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: 'Features', href: '#features', isHash: true },
    { label: 'Why Us', href: '#why-us', isHash: true },
    { label: 'Dashboard', href: '/dashboard', isHash: false },
  ];

  const handleNavClick = (e: React.MouseEvent, href: string, isHash: boolean) => {
    e.preventDefault();
    if (isHash) {
      const element = document.getElementById(href.substring(1));
      element?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(href);
    }
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-gray-900/80 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-electric-blue/5'
          : 'bg-transparent'
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <motion.a
            href="/"
            className="flex items-center gap-3 group"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <div className="relative">
              <div className="absolute inset-0 bg-electric-blue blur-xl opacity-20 group-hover:opacity-40 transition-opacity" />
              <Rocket className="w-7 h-7 md:w-8 md:h-8 text-electric-blue relative" />
            </div>
            <span className="font-heading font-bold text-xl md:text-2xl tracking-tight text-white">
              DevOrbit
            </span>
          </motion.a>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navItems.map((item, idx) => (
              <motion.a
                key={item.href}
                href={item.href}
                className="font-body font-medium text-sm text-gray-300 hover:text-white transition-colors relative group"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + idx * 0.1 }}
                onClick={(e) => handleNavClick(e, item.href, item.isHash)}
              >
                {item.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-electric-blue to-cyber-purple group-hover:w-full transition-all duration-300" />
              </motion.a>
            ))}

            {/* CTA Button */}
            <motion.button
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="relative group"
              onClick={() => {
                const element = document.getElementById('contact');
                element?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-lg blur-md opacity-75 group-hover:opacity-100 transition-opacity" />
              <div className="relative px-6 py-2.5 bg-gray-900 border border-electric-blue/50 rounded-lg font-body font-semibold text-sm text-white group-hover:border-electric-blue transition-colors">
                Book a Call
              </div>
            </motion.button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-gray-300 hover:text-white transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-white/10 py-4 bg-gray-900/95 backdrop-blur-xl"
          >
            <div className="flex flex-col gap-4">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="font-body font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
                  onClick={(e) => {
                    handleNavClick(e, item.href, item.isHash);
                    setMobileMenuOpen(false);
                  }}
                >
                  {item.label}
                </a>
              ))}
              <button
                className="mx-4 px-6 py-3 bg-gradient-to-r from-electric-blue to-cyber-purple rounded-lg font-body font-semibold text-white"
                onClick={() => {
                  const element = document.getElementById('contact');
                  element?.scrollIntoView({ behavior: 'smooth' });
                  setMobileMenuOpen(false);
                }}
              >
                Book a Call
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.nav>
  );
}
