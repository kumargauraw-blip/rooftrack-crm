# RoofTrack CRM — Production Deployment Guide

## Architecture
```
[Browser] → crm.honestroof.com (Vercel - static frontend)
                ↓ API calls
            api.honestroof.com (AWS server - Express + SQLite)
```

---

## PART 1: AWS Server (Backend + Database)

### Prerequisites
Run these commands on your AWS server via SSH.

#### Step 1: Check what you have
```bash
# Check OS
cat /etc/os-release

# Check if Node.js is installed
node -v
npm -v

# Check web server
which nginx && nginx -v
which apache2 && apache2 -v
which lsws  # LiteSpeed

# Check available disk space
df -h

# Find HonestRoof home folder
# It's usually one of these:
ls /var/www/honestroof.com/
ls /home/honestroof/
ls /var/www/html/
```

**Send me the output of these commands** and I'll customize the rest.

#### Step 2: Install Node.js (if not installed)
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Amazon Linux 2
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# Verify
node -v   # Should show v22.x
npm -v    # Should show 10.x+
```

#### Step 3: Install PM2 (process manager)
```bash
sudo npm install -g pm2
```

#### Step 4: Clone the repo
```bash
# Navigate to HonestRoof home folder (adjust path as needed)
cd /var/www/honestroof.com/

# Clone the CRM into a subfolder
git clone https://github.com/kumargauraw/rooftrack-crm.git crm
cd crm/app
```

#### Step 5: Install dependencies
```bash
# Install server dependencies
cd server
npm install --production
cd ..
```

#### Step 6: Create environment file
```bash
cat > .env << 'EOF'
NODE_ENV=production
PORT=3001
JWT_SECRET=CHANGE-THIS-TO-A-RANDOM-STRING-minimum-32-chars
DATABASE_PATH=./rooftrack.db
CORS_ORIGINS=crm.honestroof.com
EOF
```

**IMPORTANT:** Change `JWT_SECRET` to a real random string:
```bash
# Generate a random secret
openssl rand -hex 32
```

#### Step 7: Initialize the database
```bash
# Start the server once to create the DB and run migrations
node server/index.js &
sleep 5
curl http://localhost:3001/api/health
# Should return: {"status":"ok","uptime":...}

# Kill it (PM2 will manage it)
kill %1
```

#### Step 8: Import customer data
```bash
# Copy the customer data file to the server first, then:
node server/ingest-customers.js /path/to/customer-data.txt
```
Or I can help you import via the API after the server is running.

#### Step 9: Start with PM2
```bash
# Start the server
pm2 start server/index.js --name rooftrack-crm

# Save PM2 config so it starts on reboot
pm2 save
pm2 startup
# (follow the command it outputs)

# Check it's running
pm2 status
pm2 logs rooftrack-crm
```

#### Step 10: Set up reverse proxy

**If using Nginx:**
```bash
sudo nano /etc/nginx/sites-available/api.honestroof.com
```
Paste:
```nginx
server {
    listen 80;
    server_name api.honestroof.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Then:
```bash
sudo ln -s /etc/nginx/sites-available/api.honestroof.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**If using Apache:**
```bash
sudo nano /etc/apache2/sites-available/api.honestroof.com.conf
```
Paste:
```apache
<VirtualHost *:80>
    ServerName api.honestroof.com
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:3001/
    ProxyPassReverse / http://localhost:3001/
    
    <Proxy *>
        Order deny,allow
        Allow from all
    </Proxy>
</VirtualHost>
```
Then:
```bash
sudo a2enmod proxy proxy_http
sudo a2ensite api.honestroof.com.conf
sudo systemctl reload apache2
```

**If using LiteSpeed:**
Add a Virtual Host in the LiteSpeed admin panel (port 7080):
- Virtual Host Name: `api.honestroof.com`
- Document Root: `/var/www/honestroof.com/crm/app`
- External App: proxy to `localhost:3001`
- Or use `.htaccess` with RewriteRule proxy (depends on your LiteSpeed config)

**Send me which web server you're running** and I'll give exact steps.

#### Step 11: SSL via Cloudflare
No server-side SSL needed — Cloudflare handles it. Just make sure:
- Cloudflare SSL mode is "Full" (not "Full Strict" unless you also set up server-side certs)
- The DNS record points to your AWS server IP

---

## PART 2: Cloudflare DNS

Add these DNS records in your Cloudflare dashboard for `honestroof.com`:

| Type  | Name  | Content              | Proxy |
|-------|-------|----------------------|-------|
| A     | api   | YOUR_AWS_SERVER_IP   | ✅ On |

This creates `api.honestroof.com` pointing to your AWS server.

---

## PART 3: Vercel (Frontend)

#### Step 1: Create Vercel account
Go to https://vercel.com and sign up with your GitHub account.

#### Step 2: Import the repo
1. Click "New Project"
2. Import `kumargauraw/rooftrack-crm`
3. Configure:
   - **Framework Preset:** Vite
   - **Root Directory:** `client`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

#### Step 3: Set environment variable
In Vercel project settings → Environment Variables:
```
VITE_API_URL = https://api.honestroof.com/api
```

#### Step 4: Custom domain
1. In Vercel project settings → Domains
2. Add: `crm.honestroof.com`
3. Vercel will tell you to add a CNAME record

In Cloudflare DNS:

| Type  | Name  | Content                  | Proxy |
|-------|-------|--------------------------|-------|
| CNAME | crm   | cname.vercel-dns.com     | ❌ Off |

**Note:** Cloudflare proxy must be OFF (grey cloud) for Vercel domains — Vercel needs to handle its own SSL.

#### Step 5: Deploy
Vercel auto-deploys on every push to `main`. Done!

---

## PART 4: Verify

1. **Backend:** `curl https://api.honestroof.com/api/health`
   - Should return: `{"status":"ok","uptime":...}`

2. **Frontend:** Open `https://crm.honestroof.com`
   - Should show the login page
   - Login with Dennis's credentials
   - Check dashboard, customers, storm map

3. **Auto-deploy test:**
   - Push any change to `main`
   - Vercel rebuilds frontend automatically
   - Backend: `cd /var/www/honestroof.com/crm/app && git pull && pm2 restart rooftrack-crm`

---

## Quick Reference

| Component | URL | Location |
|-----------|-----|----------|
| Frontend  | crm.honestroof.com | Vercel (auto-deploy) |
| Backend API | api.honestroof.com | AWS server :3001 |
| Database  | SQLite file | AWS: crm/app/rooftrack.db |
| Repo | github.com/kumargauraw/rooftrack-crm | Source of truth |
| Staging | rooftrack.gauraw.com | Mac mini (dev) |

## Updating Backend (after git push)
```bash
ssh your-aws-server
cd /var/www/honestroof.com/crm/app
git pull origin main
cd server && npm install --production
pm2 restart rooftrack-crm
```

## Backup Database
```bash
# Add to crontab: daily backup at 2 AM
0 2 * * * cp /var/www/honestroof.com/crm/app/rooftrack.db /var/www/honestroof.com/crm/backups/rooftrack-$(date +\%Y\%m\%d).db
```
