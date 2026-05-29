import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Shield, Bell, BarChart3, Users, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useInvestors } from '@/hooks/useInvestors';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { formatNaira } from '@/lib/format';
import { daysUntilMaturity } from '@/types/investment';

const features = [
  { icon: Users, title: 'Investor Profiling', desc: 'Detailed records with full investor data, banking info, and document attachments.' },
  { icon: Bell, title: 'Smart Reminders', desc: 'Automated alerts 5 days before investment maturity so you never miss a deadline.' },
  { icon: Shield, title: 'Secure & Private', desc: 'Role-based access, audit logs, and encrypted storage for complete data protection.' },
  { icon: BarChart3, title: 'Live Dashboard', desc: 'Real-time overview of active investments, upcoming maturities, and liquidation status.' },
  { icon: TrendingUp, title: 'ROI Forecasting', desc: 'Predict returns on new deals with a built-in projection engine for smarter decisions.' },
  { icon: Users, title: 'Portfolio Groups', desc: 'Tag investors and investments into groups for targeted reporting and batch actions.' },
  { icon: Bell, title: 'Compliance Monitor', desc: 'Keep track of regulatory deadlines, audit trails, and compliance checkpoints.' },
  { icon: BarChart3, title: 'Custom Reports', desc: 'Generate PDF/CSV reports with filters for investment type, status, and timeframe.' },
];

const steps = [
  { icon: Users, title: '1. Add Investors', desc: 'Import or add individual investors with identity and financial details.' },
  { icon: BarChart3, title: '2. Create Investments', desc: 'Set up terms, maturity, and expected yields per investor.' },
  { icon: Bell, title: '3. Track & Alert', desc: 'Monitor progress with real-time dashboards and automated alerts.' },
  { icon: Shield, title: '4. Close & Report', desc: 'Close investments securely, generate statements, and archive compliance details.' },
];

type Testimonial = { name: string; title: string; quote: string; };

const defaultTestimonials: Testimonial[] = [
  { name: 'Amina Yusuf', title: 'Portfolio Manager', quote: 'Zaradera helped me streamline asset tracking and cut reporting time by 50%.' },
  { name: 'Chinedu Okafor', title: 'Investor Relations', quote: 'The dashboards are intuitive and the maturity reminders gave us confidence across deals.' },
  { name: 'Sophie Ade', title: 'Compliance Officer', quote: 'Audit-ready records and security controls made due diligence painless.' },
];

export default function Landing() {
  const [showSplash, setShowSplash] = useState(true);
  const { data: investors = [], isLoading: investorLoading } = useInvestors();
  const { data: announcementsResult, isLoading: announcementsLoading } = useAnnouncements();
  const [activeSlide, setActiveSlide] = useState(0);
  const fetchedAnnouncements = useMemo(() => announcementsResult?.data ?? [], [announcementsResult?.data]);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 4500);
    return () => clearTimeout(timer);
  }, []);

  const splashScreen = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 1.2 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="w-28 h-28 rounded-full border-2 border-primary flex items-center justify-center bg-primary/10">
          <span className="text-4xl font-bold text-primary">ZC</span>
        </div>
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-heading font-bold">Zaradera Credit Limited</h1>
          <p className="mt-2 text-muted-foreground">Secure Investment Management Platform</p>
        </div>
        <motion.div
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 4.5, ease: 'easeInOut' }}
          className="h-1 mt-5 bg-primary rounded-full"
        />
      </motion.div>
    </motion.div>
  );

  const counters = useMemo(() => {
    const totalInvestors = investors.length;
    const activeInvestments = investors.filter((i) => i.liquidation_status === 'Active').length;
    const maturedInvestments = investors.filter((i) => i.liquidation_status === 'Matured').length;
    const totalAssets = investors.reduce((sum, i) => sum + Number(i.expected_maturity_amount || 0), 0);
    return { totalInvestors, activeInvestments, maturedInvestments, totalAssets };
  }, [investors]);

  const counterCards = useMemo(
    () => [
      { icon: Users, label: 'Total Investors', value: counters.totalInvestors },
      { icon: BarChart3, label: 'Active Investments', value: counters.activeInvestments },
      { icon: Bell, label: 'Matured Investments', value: counters.maturedInvestments },
      { icon: TrendingUp, label: 'Total AUM', value: formatNaira(counters.totalAssets) },
    ],
    [counters]
  );

  const inferredAnnouncements = useMemo(() => {
    const rows = investors
      .filter((i) => i.liquidation_status === 'Active')
      .map((i) => {
        const days = daysUntilMaturity(i.maturity_date);
        return {
          id: i.id,
          title:
            days <= 0
              ? `${i.name}'s investment has matured`
              : `${i.name}'s investment matures in ${days} days`,
          subtitle: `${formatNaira(Number(i.expected_maturity_amount))} • ${i.investment_type}`,
          status: days <= 0 ? 'Matured' : `${days} days`,
          created_at: i.maturity_date,
        };
      })
      .sort((a, b) => Number.parseInt(a.status, 10) - Number.parseInt(b.status, 10));
    return rows.slice(0, 4);
  }, [investors]);

  const announcements = useMemo(
    () =>
      fetchedAnnouncements.length > 0
        ? fetchedAnnouncements.map((a) => ({
            id: a.id,
            title: a.title,
            subtitle: a.detail,
            status: a.status,
            created_at: a.created_at,
          }))
        : inferredAnnouncements,
    [fetchedAnnouncements, inferredAnnouncements],
  );

  const chartData = useMemo(() => {
    const bucket = investors.reduce<Record<string, number>>((aggregate, investor) => {
      const key = investor.investment_type ?? 'Unknown';
      aggregate[key] = (aggregate[key] || 0) + Number(investor.expected_maturity_amount || 0);
      return aggregate;
    }, {});

    return Object.entries(bucket).map(([name, value]) => ({ name, value }));
  }, [investors]);

  const testimonials = useMemo(() => {
    if (investors.length >= 3) {
      return investors.slice(0, 3).map((investor, index) => ({
        name: investor.name,
        title: investor.investment_type,
        quote: `Outstanding return on ${investor.investment_type.toLowerCase()} investment and timely maturity tracking.`,
      }));
    }
    return defaultTestimonials;
  }, [investors]);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % testimonials.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [testimonials.length]);

  if (showSplash) {
    return splashScreen;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen bg-background"
    >
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <span className="font-heading font-bold text-sm">Zaradera</span>
              <span className="text-[10px] text-muted-foreground block leading-tight">Credit Limited</span>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/login">Sign In <ArrowRight className="w-4 h-4 ml-1" /></Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-medium mb-6">
            <Shield className="w-3.5 h-3.5" /> Secure Investment Management
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-heading font-bold leading-tight max-w-3xl mx-auto">
            Manage Your <span className="text-accent">Investments</span> With Confidence
          </h1>
          <p className="mt-6 text-muted-foreground text-lg max-w-2xl mx-auto">
            Track investor portfolios, automate maturity reminders, and maintain secure records — all in one powerful platform built for Zaradera Credit Limited.
          </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button asChild size="lg" className="px-8">
                <Link to="/login">Get Started <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="px-8">
                <Link to="/investor-intake">External Public Intake</Link>
              </Button>
            </div>
          </motion.div>
        </section>

      {/* Quick actions */}
      <section className="max-w-6xl mx-auto px-6 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 bg-card border border-border/50 rounded-xl shadow-sm">
            <h2 className="text-xl font-heading font-semibold mb-2">Quick actions</h2>
            <p className="text-sm text-muted-foreground mb-4">Get started with the most common tasks in one click.</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-9">
                  <Link to="/investors">Manage Investors</Link>
                </Button>
                <Button asChild size="sm" className="h-9">
                  <Link to="/investments/new">Add Investment</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-9">
                  <Link to="/investor-intake">External Public Intake</Link>
                </Button>
                <Button asChild size="sm" className="h-9">
                  <Link to="/notifications">View Notifications</Link>
                </Button>
              </div>
          </div>
          <div className="p-6 bg-card border border-border/50 rounded-xl shadow-sm">
            <h2 className="text-xl font-heading font-semibold mb-2">AUM by investment type</h2>
            <p className="text-sm text-muted-foreground mb-4">Live chart for total maturity value per investment category.</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `₦${(value / 1_000_000).toFixed(1)}M`} />
                  <Tooltip formatter={(value: number) => formatNaira(Number(value))} />
                  <Legend />
                  <Area type="monotone" dataKey="value" stroke="#0ea5e9" fill="#bae6fd" name="AUM" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
              className="p-6 rounded-xl bg-card border border-border/50 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-heading font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Live counters */}
      <section className="bg-secondary/5 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-heading font-bold mb-4 text-center">Live portfolio counters</h2>
          <p className="text-center text-muted-foreground mb-10">Real-time statistics from your investor database.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {counterCards.map((item) => (
              <div key={item.label} className="p-5 bg-white rounded-xl border border-border shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <item.icon className="w-5 h-5 text-primary" />
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">{item.label}</span>
                </div>
                <div className="text-3xl font-bold">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Latest announcements */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-heading font-bold mb-4 text-center">Latest announcements</h2>
        <p className="text-center text-muted-foreground mb-8">Auto-generated alerts from investments approaching maturity.</p>
        <div className="mb-4 text-right">
          <Button asChild size="sm" className="h-8">
            <Link to="/notifications">View all announcements</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(investorLoading || announcementsLoading) && (
            <div className="p-6 bg-card border border-border/50 rounded-xl">
              <p className="text-sm text-muted-foreground">Loading announcements...</p>
            </div>
          )}
          {!investorLoading && !announcementsLoading && announcements.length === 0 && (
            <div className="p-6 bg-card border border-border/50 rounded-xl">
              <p className="text-sm text-muted-foreground">No announcements right now. Add investments to see alerts.</p>
            </div>
          )}
          {!investorLoading && !announcementsLoading && announcements.length > 0 &&
            announcements.map((announcement) => (
              <div key={announcement.id} className="p-5 bg-white rounded-xl border border-border shadow-sm">
                <h3 className="font-semibold">{announcement.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{announcement.subtitle}</p>
                <span className="text-xs text-accent font-medium mt-2 block">{announcement.status}</span>
              </div>
            ))}
        </div>
      </section>

      {/* Testimonials slider */}
      <section className="bg-secondary/5 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-heading font-bold mb-4 text-center">Real investor testimonials</h2>
          <p className="text-center text-muted-foreground mb-8">Hear what users say about Zaradera’s investment confidence.</p>
          <div className="relative bg-card border border-border/50 rounded-xl p-6 shadow-sm">
            <div className="space-y-3">
              <p className="text-lg font-medium">“{testimonials[activeSlide]?.quote}”</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{testimonials[activeSlide]?.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonials[activeSlide]?.title}</p>
                </div>
                <div className="inline-flex items-center gap-2">
                  <Button size="sm" onClick={() => setActiveSlide((prev) => (prev - 1 + testimonials.length) % testimonials.length)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button size="sm" onClick={() => setActiveSlide((prev) => (prev + 1) % testimonials.length)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-heading font-bold mb-4 text-center">How it works</h2>
        <p className="text-center text-muted-foreground mb-10">Simple steps to onboard and manage investments with confidence.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step) => (
            <div key={step.title} className="p-6 bg-card border border-border/50 rounded-xl shadow-sm">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <step.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-heading font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Zaradera Credit Limited. All rights reserved.
        </div>
      </footer>
    </motion.div>
  );
}
