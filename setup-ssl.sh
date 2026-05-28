#!/bin/bash
set -e

DOMAIN="13.229.103.28.nip.io"
echo "=== Setting up HTTPS for $DOMAIN ==="

# Update nginx config with domain
sudo tee /etc/nginx/sites-available/vietravel-exam > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
echo "✅ Nginx configured for $DOMAIN"

# Get SSL certificate
echo "Getting SSL certificate..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@yourdomain.com --redirect
echo "✅ SSL certificate installed!"

# Enable secure cookies
cd /opt/vietravel-exam
sed -i 's/COOKIE_SECURE=.*/COOKIE_SECURE=true/' .env 2>/dev/null || echo "COOKIE_SECURE=true" >> .env
sudo systemctl restart vietravel-exam

echo ""
echo "========================================="
echo "  ✅ HTTPS ENABLED!"
echo "  URL: https://$DOMAIN"
echo "  Admin: https://$DOMAIN/admin/login.html"
echo "  Exam: https://$DOMAIN/exam/"
echo "========================================="
