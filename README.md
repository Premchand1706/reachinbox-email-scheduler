# ReachInbox Email Scheduler

A production-grade, highly reliable, and persistent SaaS email scheduling service. This application allows users to register, log in via Google OAuth (or dev sandbox), select/provision outreach senders, upload recipient email list files (CSV/TXT), configure scheduling intervals and rate limits, and monitor email delivery status in real-time.

---

## 🏗 Architecture Overview

The system is designed with a **Database-First** and **Distributed Lock-First** approach to guarantee consistency, persistence, and safe concurrent worker behavior.

```
                  ┌────────────────────────┐
                  │    Next.js Frontend    │
                  └───────────┬────────────┘
                              │ HTTP / Cookies
                              ▼
                  ┌────────────────────────┐
                  │    Express Backend     │
                  └────┬──────────────┬────┘
                       │              │
         Reads/Writes  │              │ BullMQ Jobs
                       ▼              ▼
           ┌──────────────┐      ┌──────────┐
           │  PostgreSQL  │      │  Redis   │
           └──────────────┘      └──────────┘
```

### 1. Reliable Scheduling
Scheduling does **NOT** use OS cron or Node-level intervals. Instead, it utilizes **BullMQ Delayed Jobs** backed by Redis.
- Scheduled emails are immediately persisted in the database as `EmailMessage` records in a `SCHEDULED` status.
- Corresponding BullMQ delayed jobs are created in Redis with a calculated delay.
- The queue is persistent, ensuring that **if the backend or worker crashes or restarts, future scheduled emails process at the correct time** upon boot.

### 2. DB + Queue Consistency & Startup Recovery
To ensure database records and BullMQ state do not desynchronize:
- **Batch Transaction**: Emails are saved to PostgreSQL in a transaction. BullMQ job creation occurs right after.
- **Recovery Service**: On backend startup, a recovery loop queries the database for any emails in `SCHEDULED` or `RETRYING` status that do not have active BullMQ jobs (checked deterministically by job ID) and queues them.

### 3. Execution-Time Throttling & Rate Limiting
To survive concurrent worker environments (e.g. `WORKER_CONCURRENCY=5` across multiple processes):
- **Pre-distribution Optimization**: At scheduling time, `scheduledAt` dates are spread out based on `delayBetweenSeconds` and `hourlyLimit`. This acts as an optimization to spread the load evenly in advance.
- **Authoritative Execution-Time Throttling**: The actual rate limits are enforced at worker execution time. Before sending, the worker runs an **atomic Redis Lua script** to check two rules:
  1. **Minimum Delay Throttling**: Ensures `now >= lastSendTime + MIN_EMAIL_DELAY_MS`. If breached, the job is rescheduled with a delay.
  2. **Hourly Rate Limiting**: Increments and checks an atomic Redis counter `email-rate:{senderId}:{hourWindow}`. If the hourly limit is exceeded, the job is rescheduled to the start of the next hour.
- **Why this distinction matters**: Scheduling-time spreading reduces queue congestion, but execution-time Redis atomic script-checking is the authoritative source of truth that safely coordinates multiple concurrent workers/processes without race conditions.

### 4. Atomic Idempotency & Duplicate Prevention
To ensure an email is never sent twice, the worker claims the email atomically in the database:
- Prior to SMTP sending, the worker performs an atomic Postgres query:
  `UPDATE "EmailMessage" SET status = 'PROCESSING', attempts = attempts + 1 WHERE id = $id AND status IN ('SCHEDULED', 'RETRYING') RETURNING *`
- If 0 rows are updated, the worker aborts and acknowledges the job, preventing concurrent double-sends.
- Deterministic job IDs (`email-{emailMessageId}`) in BullMQ act as a secondary deduplication layer at the queue entry point.

---

## 🛠 Tech Stack

- **Backend**: Node.js, TypeScript, Express.js, PostgreSQL (Prisma ORM), Redis, BullMQ, Nodemailer, Zod
- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS (v4), React Hook Form
- **Database/Caching**: PostgreSQL & Redis (WSL/Docker compatible)

---

## ⚙️ Environment Variables

### Backend `.env`
Create a `.env` file in the `backend/` directory:
```env
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/reachinbox?schema=public"
REDIS_URL="redis://127.0.0.1:6379"

JWT_SECRET="your_jwt_secret_key"

# Real Google OAuth Configuration
GOOGLE_CLIENT_ID="your_google_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
GOOGLE_CALLBACK_URL="http://localhost:4000/api/auth/google/callback"
FRONTEND_URL="http://localhost:3000"

# Nodemailer Ethereal Configuration (transient accounts auto-generated if left empty)
ETHEREAL_HOST="smtp.ethereal.email"
ETHEREAL_PORT=587
ETHEREAL_USER=""
ETHEREAL_PASSWORD=""
ETHEREAL_FROM="ReachInbox Scheduler <no-reply@reachinbox.ai>"

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200
ENABLE_DEV_SANDBOX=false
```

### Frontend `.env.local`
Create a `.env.local` file in the `frontend/` directory:
```env
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
NEXT_PUBLIC_ENABLE_DEV_SANDBOX=false
```

---

## 🚀 How to Run Local Development

Because host machine environments might not have Docker Desktop running, the setup supports running PostgreSQL and Redis inside **WSL2** easily.

### Step 1: Start PostgreSQL and Redis (WSL Option)
If Docker is not active, spin them up inside WSL Ubuntu:
```powershell
# Start services inside WSL (run as root to bypass password prompts)
wsl -d Ubuntu -u root service redis-server start
wsl -d Ubuntu -u root service postgresql start

# Configure Postgres database user and tables
wsl -d Ubuntu -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
wsl -d Ubuntu -u postgres psql -c "CREATE DATABASE reachinbox;"
```

*Note: Alternatively, if Docker is available, run `docker-compose up -d` at the root.*

### Step 2: Configure & Seed Backend
```powershell
cd backend
npm install
npx prisma db push
npx prisma db seed
```

### Step 3: Run Services
Run both backend and frontend servers:
```powershell
# In backend/ directory:
npm run dev

# In frontend/ directory (in a separate terminal):
npm run dev
```
- Backend will run at: `http://localhost:4000`
- Frontend will run at: `http://localhost:3000`

---

## 🧪 Running Automated Tests

We use **Vitest** for integration testing. The test suite covers:
- Scheduling 1, 10, 100 emails (verifying min-delay and timestamps).
- Simulating 1000 emails (verifying hourly limit pre-distribution).
- Concurrent worker claim race conditions.
- Restart recovery (orphaned DB records).
- Execution-time rate limit rescheduling (atomic Lua script validation).

To execute tests, make sure PostgreSQL and Redis are started, then run:
```powershell
cd backend
npm run test
```

### Verified Test Run Output:
```
 ✓ tests/scheduler.test.ts  (6 tests) 1948ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

---

## 📝 Demo Walkthrough Flow

To prove all constraints end-to-end in your submission, follow this demo flow:

1. **Google Login**: Open `http://localhost:3000`. Click **Continue with Google** to authenticate. (Once redirected, note the user profile name, email, avatar, and Logout button).
2. **Explore Dashboard**: View the clean UI displaying scheduled emails, sent emails, and statistic widgets.
3. **Compose campaign**: Click **Compose Email**. Select one of the pre-provisioned senders (e.g. `your-username.outreach@reachinbox.ai`).
4. **Lead Upload**: Drag/upload a CSV or TXT file containing 10 email addresses. Note the live validation counts (Valid: 10, Invalid: 0, Duplicates: 0).
5. **Campaign Limits**: Configure the send parameters:
   - **Delay Between Sends**: `2 seconds`
   - **Hourly Limit**: `3`
6. **Schedule & Verify Rate Limiting**: Click **Schedule**. Observe that:
   - The first 3 emails are sent within 6 seconds.
   - The remaining 7 emails are **automatically rescheduled** to the start of the next hour window.
   - *Explanation to highlight*: "The hourly limit is enforced at worker execution time using an atomic Redis Lua script, so concurrent workers cannot exceed the sender's configured limit."
7. **Verify SMTP Deliverability**: Open the **Sent & Failed** table, and click **Preview Mail** on any sent row. This will open Ethereal's actual SMTP preview page, proving the SMTP integration is live and real.
8. **Worker Restart Test (Restart Resilience)**:
   - While the remaining emails are scheduled, stop the worker container:
     ```bash
     docker compose stop worker
     ```
   - Show that all pending emails remain persisted in PostgreSQL and queue jobs remain intact in Redis.
   - Restart the worker container:
     ```bash
     docker compose start worker
     ```
   - Show the worker reconnect and resume processing.
   - *Explanation to highlight*: "The jobs aren't stored only in the Node process. BullMQ persists the delayed jobs in Redis, while PostgreSQL maintains the email state. After the worker restarts, processing resumes without starting the campaign from scratch."
