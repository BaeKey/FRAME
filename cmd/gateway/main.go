// Command gateway serves the browser-decrypted OpenList media library.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/BaeKey/FRAME/internal/catalog"
	"github.com/BaeKey/FRAME/internal/config"
	"github.com/BaeKey/FRAME/internal/logging"
	"github.com/BaeKey/FRAME/internal/server"
	"github.com/BaeKey/FRAME/internal/state"
	"github.com/BaeKey/FRAME/internal/storage"
	"github.com/BaeKey/FRAME/web"
)

func main() {
	logger, _ := logging.New(os.Stderr, "info")
	slog.SetDefault(logger)
	configPath := flag.String("config", "config.yaml", "YAML 配置文件路径")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *configPath); err != nil {
		slog.Error("gateway_failed", "reason", err.Error())
		os.Exit(1)
	}
}

// run owns resources so deferred cleanup completes before main exits.
func run(ctx context.Context, configPath string) error {
	c, err := config.Load(configPath)
	if err != nil {
		return err
	}
	logger, err := logging.New(os.Stderr, c.Logging.Level)
	if err != nil {
		return err
	}
	slog.SetDefault(logger)
	logger.Info("gateway_configured", "log_level", c.Logging.Level, "media_transport", "browser_direct", "media_proxy_enabled", false, "decrypt_location", "browser")
	key := c.DeriveKey()
	defer clear(key)
	source := storage.New(c.OpenList.BaseURL, c.OpenList.Username, c.OpenList.Password, c.OpenList.CipherBackendPath)
	namespace := state.Hash(c.OpenList.BaseURL + "\x00" + c.OpenList.Username + "\x00" + c.OpenList.CipherBackendPath)
	runtimeState := state.New()
	var rules []catalog.NamingRule
	if c.Index.NamingRules != nil {
		rules = make([]catalog.NamingRule, len(c.Index.NamingRules))
		for i, rule := range c.Index.NamingRules {
			rules[i] = catalog.NamingRule{Name: rule.Name, Template: rule.Template, Enabled: rule.Enabled}
		}
	}
	index, err := catalog.New(source, rules, runtimeState, namespace, time.Duration(c.Index.CheckIntervalSeconds)*time.Second)
	if err != nil {
		return errors.New("命名规则配置无效，请检查 index.naming_rules")
	}
	defer index.Close()
	handler := server.New(server.Options{Logger: logger, LogLevel: c.Logging.Level, AccessToken: c.Server.AccessToken, BasePath: c.Server.BasePath, KeyTTL: time.Duration(c.Session.KeyTTLSeconds) * time.Second}, key, source, web.Assets, index, runtimeState)
	clear(key)
	c.Crypt.Password = ""
	c.Crypt.SaltBase64 = ""
	srv := &http.Server{BaseContext: func(net.Listener) context.Context { return ctx }, Addr: c.Server.Listen, Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	return serve(ctx, srv)
}

func serve(ctx context.Context, srv *http.Server) error {
	done := make(chan error, 1)
	go func() {
		done <- srv.ListenAndServe()
	}()
	slog.Info("gateway_starting", "listen", srv.Addr)
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		// Do not expose certificate or request details from external libraries.
		return errors.New("HTTP 服务启动失败，请检查监听地址")
	case <-ctx.Done():
		slog.Info("gateway_stopping")
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			_ = srv.Close() // Cancel active requests after graceful shutdown expires.
			<-done
			return fmt.Errorf("HTTP graceful shutdown: %w", err)
		}
		<-done
		return nil
	}
}
