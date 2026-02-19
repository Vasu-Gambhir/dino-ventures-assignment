import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import transactionRoutes from './routes/transaction.routes';
import walletRoutes from './routes/wallet.routes';
import { errorHandler } from './middleware/error';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/wallets', walletRoutes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
