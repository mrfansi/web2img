#!/bin/bash

# System Optimization Script for 2000 Concurrent Screenshots
# For 32-core, 512GB RAM server

echo "🚀 Optimizing system for 2000 concurrent screenshots..."

# 1. Increase file descriptor limits
echo "📁 Setting file descriptor limits..."
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf
echo "fs.file-max = 2097152" >> /etc/sysctl.conf

# 2. Optimize memory settings
echo "💾 Optimizing memory settings..."
echo "vm.swappiness = 1" >> /etc/sysctl.conf
echo "vm.dirty_ratio = 15" >> /etc/sysctl.conf
echo "vm.dirty_background_ratio = 5" >> /etc/sysctl.conf
echo "vm.overcommit_memory = 1" >> /etc/sysctl.conf

# 3. Network optimizations
echo "🌐 Optimizing network settings..."
echo "net.core.somaxconn = 65536" >> /etc/sysctl.conf
echo "net.core.netdev_max_backlog = 5000" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65536" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_time = 600" >> /etc/sysctl.conf

# 4. Process and thread limits
echo "⚙️  Setting process limits..."
echo "kernel.pid_max = 4194304" >> /etc/sysctl.conf
echo "kernel.threads-max = 4194304" >> /etc/sysctl.conf

# 5. Shared memory settings for Chrome/Playwright
echo "🔧 Optimizing shared memory..."
echo "kernel.shmmax = 68719476736" >> /etc/sysctl.conf  # 64GB
echo "kernel.shmall = 16777216" >> /etc/sysctl.conf

# 6. Apply settings
echo "✅ Applying system settings..."
sysctl -p

# 7. Create optimized systemd service
echo "📋 Creating systemd service..."
cat > /etc/systemd/system/web2img-high-performance.service << EOF
[Unit]
Description=Web2img High Performance Screenshot Service
After=network.target

[Service]
Type=simple
User=web2img
Group=web2img
WorkingDirectory=/opt/web2img
Environment=PATH=/opt/web2img/.venv/bin
ExecStart=/opt/web2img/.venv/bin/python main.py
EnvironmentFile=/opt/web2img/.env.high_performance
Restart=always
RestartSec=10

# Resource limits for high performance
LimitNOFILE=65536
LimitNPROC=32768
LimitMEMLOCK=infinity

# Memory and CPU settings
MemoryMax=480G
CPUQuota=3200%

[Install]
WantedBy=multi-user.target
EOF

# 8. Create monitoring script
echo "📊 Creating monitoring script..."
cat > /opt/web2img/scripts/monitor_performance.sh << 'EOF'
#!/bin/bash

# Performance monitoring for 2000 concurrent setup
echo "=== Web2img Performance Monitor ==="
echo "Timestamp: $(date)"
echo

# Memory usage
echo "📊 Memory Usage:"
free -h
echo

# CPU usage
echo "🖥️  CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
echo

# Browser processes
echo "🌐 Browser Processes:"
ps aux | grep -E "(chrome|chromium)" | wc -l
echo

# Network connections
echo "🔗 Network Connections:"
ss -tuln | wc -l
echo

# Disk usage
echo "💾 Disk Usage:"
df -h /tmp/web2img 2>/dev/null || echo "Screenshot directory not found"
echo

# Service status
echo "⚙️  Service Status:"
systemctl is-active web2img-high-performance
echo

echo "=== End Monitor ==="
EOF

chmod +x /opt/web2img/scripts/monitor_performance.sh

echo "✅ System optimization complete!"
echo "📝 Next steps:"
echo "1. Copy your .env.high_performance file to the application directory"
echo "2. Install the application in /opt/web2img/"
echo "3. Start the service: systemctl start web2img-high-performance"
echo "4. Monitor performance: /opt/web2img/scripts/monitor_performance.sh"
