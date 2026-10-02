"use client";

import { useState } from "react";
import { Shield, Check, Lock, ArrowRight, Zap, Globe, Users, TrendingUp, Menu, X } from 'lucide-react';

const SENTRYOPS_ORIGIN = "https://sentryops-prototype-co845i4oz-dwights-projects-8a9a094f.vercel.app";
const ORIGINAL_CSS = SENTRYOPS_ORIGIN + "/assets/index-DoDyeJAG.css";

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
    <link rel="stylesheet" href={ORIGINAL_CSS} />
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0d1424] to-slate-950">
      {/* Nav */}
      <nav className="border-b border-slate-800/50 backdrop-blur-xl bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-slate-900" />
              </div>
              <span className="text-xl font-bold text-white">SentryOps</span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-4">
              <a href="#features" className="text-slate-300 hover:text-white transition-colors">Features</a>
              <a href="#security" className="text-slate-300 hover:text-white transition-colors">Security</a>
              <a href="#pricing" className="text-slate-300 hover:text-white transition-colors">Pricing</a>
              <a href={SENTRYOPS_ORIGIN + "/signin"} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-medium transition-colors flex items-center gap-2"
              >
                <Lock className="w-4 h-4" />
                Sign In
              </a>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 space-y-3">
              <a href="#features" className="block text-slate-300 hover:text-white transition-colors">Features</a>
              <a href="#security" className="block text-slate-300 hover:text-white transition-colors">Security</a>
              <a href="#pricing" className="block text-slate-300 hover:text-white transition-colors">Pricing</a>
              <a href={SENTRYOPS_ORIGIN + "/signin"} target="_blank" rel="noopener noreferrer"
                className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                Sign In
              </a>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-6 py-12 md:py-20">
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-400 text-xs font-semibold uppercase tracking-widest mb-6">
            <Shield className="w-3.5 h-3.5" />
            Law Enforcement Command Platform
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
            The Central Hub for<br />Sheriff Operations
          </h1>
          <p className="text-lg md:text-xl text-slate-400 mb-8 max-w-2xl mx-auto px-4">
            Unified command platform that integrates your existing tools into one AI-powered hub.
            Built for law enforcement, designed for efficiency.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button className="w-full sm:w-auto px-6 py-3 bg-amber-500 hover:bg-amber-600 rounded-xl text-white font-medium transition-colors flex items-center justify-center gap-2">
              Request Demo
              <ArrowRight className="w-5 h-5" />
            </button>
            <button className="w-full sm:w-auto px-6 py-3 bg-slate-800/40 hover:bg-slate-800/60 border border-slate-700/50 rounded-xl text-white font-medium transition-colors">
              View Documentation
            </button>
          </div>
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 mb-12 md:mb-16 text-sm text-slate-400 px-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-slate-500" />
            <span>CJIS Compliant</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-slate-500" />
            <span>AWS GovCloud</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-slate-500" />
            <span>SOC 2 Type II</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-slate-500" />
            <span>GDPR Ready</span>
          </div>
        </div>

        {/* Screenshot Mockup */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-slate-700/10 to-slate-600/10 blur-3xl"></div>
          <div className="relative bg-slate-900/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-2">
            <div className="bg-slate-950 rounded-xl aspect-video flex items-center justify-center">
              <div className="text-center">
                <Shield className="w-12 h-12 md:w-20 md:h-20 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-400 text-sm md:text-base">Dashboard Preview</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-7xl mx-auto px-6 py-12 md:py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">Everything You Need</h2>
        <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto px-4">
          Integrate all your existing tools into one intelligent platform
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {[
            { icon: Users, title: 'Personnel Management', desc: 'Complete staff directory with certifications, training, and scheduling' },
            { icon: Globe, title: 'System Integration', desc: 'Connect NeoGov, PowerDMS, RMS/CAD, and more in one hub' },
            { icon: Zap, title: 'AI Assistant', desc: 'Context-aware AI that helps you work faster and smarter' },
            { icon: TrendingUp, title: 'Real-time Analytics', desc: 'Live dashboards with KPIs, compliance tracking, and insights' },
            { icon: Shield, title: 'Enterprise Security', desc: 'CJIS-compliant with role-based access and full audit trails' },
            { icon: Lock, title: 'Background Checks', desc: 'Streamlined applicant tracking with AI-powered summaries' }
          ].map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <div key={idx} className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-xl p-6 hover:border-slate-600/50 transition-all">
                <div className="w-12 h-12 bg-slate-700/60 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400">{feature.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-7xl mx-auto px-6 py-12 md:py-20">
        <div className="bg-slate-800/30 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to transform your operations?</h2>
          <p className="text-slate-400 mb-8 max-w-2xl mx-auto px-4">
            Join forward-thinking sheriff's departments using SentryOps to streamline operations and improve efficiency.
          </p>
          <button className="px-8 py-4 bg-amber-500 hover:bg-amber-600 rounded-xl text-white font-medium text-lg transition-colors inline-flex items-center gap-2">
            Schedule a Demo
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
            <p>© 2024 SentryOps. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Security</a>
              <a href="#" className="hover:text-white transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </>
  );
}
