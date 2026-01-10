import { ShaderBackground } from './ShaderBackground';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { Services } from './Services';
import { WhyUs } from './WhyUs';
import { Footer } from './Footer';

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-obsidian text-white overflow-x-hidden">
      {/* Shader Background */}
      <ShaderBackground />

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
