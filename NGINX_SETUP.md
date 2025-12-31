# Nginx Configuration untuk ShadowChat Dashboard & Webhook

## Setup Nginx dengan Domain

### 1. Install Nginx (jika belum)
```bash
# Termux/Android
pkg install nginx

# Linux Debian/Ubuntu
apt update && apt install nginx

# CentOS/RHEL
yum install nginx
```

### 2. Konfigurasi Nginx

Buat file konfigurasi: `/etc/nginx/sites-available/shadowchat`

```nginx
# HTTP - Redirect ke HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect semua HTTP ke HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS - Main Configuration
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Certificate (gunakan Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # SSL Configuration (Security Best Practices)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/shadowchat-access.log;
    error_log /var/log/nginx/shadowchat-error.log;

    # Rate Limiting (prevent DDoS)
    limit_req_zone $binary_remote_addr zone=webhook:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=dashboard:10m rate=5r/s;

    # Webhook Endpoint untuk Trakteer
    location /webhook/trakteer {
        limit_req zone=webhook burst=20 nodelay;
        
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health Check Endpoint
    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

    # Admin Dashboard - Protected
    location /admin {
        limit_req zone=dashboard burst=10 nodelay;
        
        # Basic Auth (optional - tambahan keamanan)
        # auth_basic "Admin Area";
        # auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Block direct access ke root
    location / {
        return 403;
    }

    # Deny access to hidden files
    location ~ /\. {
        deny all;
    }
}
```

### 3. Konfigurasi Minimalis (untuk Termux/Android)

File: `~/nginx.conf` atau `/data/data/com.termux/files/usr/etc/nginx/nginx.conf`

```nginx
events {
    worker_connections 1024;
}

http {
    upstream shadowchat_backend {
        server 127.0.0.1:8000;
        keepalive 64;
    }

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=webhook:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=dashboard:10m rate=5r/s;

    server {
        listen 80;
        server_name yourdomain.com;

        # Webhook Trakteer
        location /webhook/trakteer {
            limit_req zone=webhook burst=20 nodelay;
            proxy_pass http://shadowchat_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # Health Check
        location /health {
            proxy_pass http://shadowchat_backend;
            access_log off;
        }

        # Admin Dashboard
        location /admin {
            limit_req zone=dashboard burst=10 nodelay;
            proxy_pass http://shadowchat_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location / {
            return 403;
        }
    }
}
```

### 4. Setup SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
apt install certbot python3-certbot-nginx

# Generate SSL Certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal (add to crontab)
crontab -e
# Add this line:
0 0 * * * certbot renew --quiet
```

### 5. Enable Configuration

```bash
# Symlink configuration (Linux)
ln -s /etc/nginx/sites-available/shadowchat /etc/nginx/sites-enabled/

# Test Nginx configuration
nginx -t

# Reload Nginx
systemctl reload nginx
# atau
service nginx reload
# atau (Termux)
nginx -s reload
```

### 6. Update .env untuk Production

```env
# Webhook Configuration
WEBHOOK_HOST=0.0.0.0
WEBHOOK_PORT=8000

# Domain untuk webhook
WEBHOOK_DOMAIN=https://yourdomain.com

# Admin Token (GANTI dengan token yang kuat!)
ADMIN_TOKEN=your_very_secure_random_token_here_change_me
```

### 7. Firewall Configuration (Optional)

```bash
# UFW (Ubuntu/Debian)
ufw allow 'Nginx Full'
ufw allow 22/tcp
ufw enable

# Atau manual
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp
```

### 8. PM2 untuk Keep Bot Running

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start index.js --name shadowchat-bot

# Start webhook server
pm2 start webhook_server.js --name shadowchat-webhook

# Auto-start on reboot
pm2 startup
pm2 save

# Monitor
pm2 monit
pm2 logs
```

### 9. Konfigurasi Trakteer Webhook

Di Trakteer Dashboard:
1. Masuk ke Settings > Webhooks
2. Set Webhook URL: `https://yourdomain.com/webhook/trakteer`
3. Set Webhook Secret: (sesuai TRAKTEER_WEBHOOK_SECRET di .env)
4. Test webhook

### 10. Testing

```bash
# Test webhook
curl -X POST https://yourdomain.com/webhook/trakteer \
  -H "Content-Type: application/json" \
  -H "x-trakteer-signature: test" \
  -d '{"test": "data"}'

# Test health check
curl https://yourdomain.com/health

# Test admin dashboard (dengan auth)
curl -H "Authorization: Bearer your_admin_token" \
  https://yourdomain.com/admin/dashboard
```

### 11. Monitoring & Logs

```bash
# Nginx logs
tail -f /var/log/nginx/shadowchat-access.log
tail -f /var/log/nginx/shadowchat-error.log

# PM2 logs
pm2 logs shadowchat-webhook
pm2 logs shadowchat-bot

# System monitoring
pm2 monit
```

---

## Struktur Akhir

```
Domain: yourdomain.com

URLs:
- https://yourdomain.com/webhook/trakteer → Bot Webhook (port 8000)
- https://yourdomain.com/admin/dashboard → Admin Dashboard (port 8000)
- https://yourdomain.com/admin/api/stats → API Stats
- https://yourdomain.com/health → Health Check

Nginx: Port 80/443
  ↓
Node.js Webhook Server: Port 8000
  ↓
Bot Process (Telegram)
  ↓
Supabase Database
```

---

## Keamanan Tambahan (Optional)

### Basic Auth untuk Dashboard

```bash
# Install htpasswd
apt install apache2-utils

# Create password file
htpasswd -c /etc/nginx/.htpasswd admin

# Uncomment di nginx config:
# auth_basic "Admin Area";
# auth_basic_user_file /etc/nginx/.htpasswd;
```

### IP Whitelist untuk Admin

```nginx
location /admin {
    # Only allow specific IPs
    allow 103.xxx.xxx.xxx;  # Your IP
    deny all;
    
    proxy_pass http://127.0.0.1:8000;
    # ... rest of config
}
```

### Fail2Ban untuk Brute Force Protection

```bash
# Install fail2ban
apt install fail2ban

# Create /etc/fail2ban/filter.d/nginx-admin.conf
[Definition]
failregex = ^<HOST> - .* "GET /admin.*" 401
ignoreregex =

# Create /etc/fail2ban/jail.d/nginx-admin.conf
[nginx-admin]
enabled = true
port = http,https
filter = nginx-admin
logpath = /var/log/nginx/shadowchat-access.log
maxretry = 5
bantime = 3600
```

---

## Troubleshooting

### Nginx tidak bisa start
```bash
nginx -t  # Check config errors
systemctl status nginx  # Check status
journalctl -xe  # Check logs
```

### Webhook tidak terima data
```bash
# Check if server running
netstat -tlnp | grep 8000

# Check logs
pm2 logs shadowchat-webhook

# Test direct (bypass nginx)
curl http://localhost:8000/health
```

### SSL Certificate Issues
```bash
certbot renew --dry-run
certbot certificates
```

---

**Setup Complete! Dashboard & Webhook siap dengan Nginx + SSL! 🚀**
