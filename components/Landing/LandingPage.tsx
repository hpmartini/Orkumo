import { lazy, Suspense } from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { Services } from './Services';
import { WhyUs } from './WhyUs';
import { Footer } from './Footer';

// Lazy load ShaderBackground for better First Contentful Paint (FCP)
// This defers Three.js loading (~600KB) until after initial page render
const ShaderBackground = lazy(() =>
  import('./ShaderBackground').then((module) => ({
    default: module.ShaderBackground,
  }))
);

// Simple gradient fallback while shader loads
const ShaderFallback = () => (
  <div className="fixed inset-0 -z-10 bg-gradient-to-br from-gray-900 via-gray-900 to-black" />
);

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-obsidian text-white overflow-x-hidden">
      {/* Shader Background - Lazy loaded for performance */}
      <Suspense fallback={<ShaderFallback />}>
        <ShaderBackground />
      </Suspense>

      {/* Content */}
      <div className="relative z-10">
        <Navbar />
        <Hero />
        <Services />
        <WhyUs />
        <Footer />
      </div>
    </div>
  );
}
