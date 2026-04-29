import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Splash() {
  const navigate = useNavigate();
  const splashDurationMs = 1800;

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/login', { replace: true });
    }, splashDurationMs);

    return () => clearTimeout(timer);
  }, [navigate, splashDurationMs]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ exit: { duration: 0.5 } }}
      className="fixed inset-0 flex items-center justify-center bg-background"
    >
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.2 }}
          className="mx-auto flex h-32 w-32 items-center justify-center"
        >
          <img
            src="/assets/Zaradera_Logo_Path.png"
            alt="Zaradera Credit Limited Logo"
            className="h-28 w-28 object-contain"
            onError={(e) => {
              // Fallback to text if image fails to load
              e.currentTarget.style.display = 'none';
              const fallback = document.createElement('span');
              fallback.className = 'text-4xl font-bold text-primary';
              fallback.textContent = 'ZC';
              e.currentTarget.parentElement?.appendChild(fallback);
            }}
          />
        </motion.div>

        <motion.h1
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="mt-6 text-3xl md:text-4xl font-heading font-bold"
        >
          <div className="text-primary">
          Zaradera Credit Limited
          </div>
        </motion.h1>

        <motion.p
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="mt-2 text-muted-foreground"
        >
          Secure Investment Management Platform
        </motion.p>

        <motion.div
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: splashDurationMs / 1000, ease: 'easeInOut' }}
          className="mx-auto mt-6 h-1 max-w-md rounded-full"
          style={{ backgroundColor: 'rgba(242, 76, 33, 0.18)' }}
        >
          <div className="h-1 rounded-full" style={{ backgroundColor: '#F24C21' }} />
        </motion.div>

        <p className="mt-2 text-sm text-muted-foreground">
          Redirecting to sign in...
        </p>
      </div>
    </motion.div>
  );
}
