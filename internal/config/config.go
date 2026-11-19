// Package config loads and validates server-only YAML configuration.
package config

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/BaeKey/FRAME/internal/logging"
	"golang.org/x/crypto/argon2"
	"gopkg.in/yaml.v3"
)

// Config contains deployment settings and credentials; it must not be logged.
type NamingRule struct {
	Name     string `yaml:"name"`
	Template string `yaml:"template"`
	Enabled  bool   `yaml:"enabled"`
}

type Config struct {
	Logging struct {
		Level string `yaml:"level"`
	} `yaml:"logging"`
	Index struct {
		CheckIntervalSeconds int          `yaml:"check_interval_seconds"`
		NamingRules          []NamingRule `yaml:"naming_rules"`
	} `yaml:"index"`
	Server struct {
		Listen      string `yaml:"listen"`
		BasePath    string `yaml:"base_path"`
		AccessToken string `yaml:"access_token"`
	} `yaml:"server"`
	OpenList struct {
		BaseURL           string `yaml:"base_url"`
		Username          string `yaml:"username"`
		Password          string `yaml:"password"`
		CipherBackendPath string `yaml:"cipher_backend_path"`
	} `yaml:"openlist"`
	Crypt struct {
		Password   string `yaml:"password"`
		SaltBase64 string `yaml:"salt_base64"`
		Argon2     struct {
			Time      uint32 `yaml:"time"`
			MemoryKiB uint32 `yaml:"memory_kib"`
			Threads   uint8  `yaml:"threads"`
		} `yaml:"argon2"`
	} `yaml:"crypt"`
	Session struct {
		KeyTTLSeconds int `yaml:"key_ttl_seconds"`
	} `yaml:"session"`
}

// Load reads one configuration file and applies defaults and validation.
func Load(filename string) (*Config, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败: %w", err)
	}
	defer f.Close()
	return Decode(f)
}

// Decode rejects unknown fields and redacts YAML errors that may contain secrets.
func Decode(r io.Reader) (*Config, error) {
	c := &Config{}
	c.Logging.Level = "info"
	c.Index.CheckIntervalSeconds = 600
	c.Server.Listen = "127.0.0.1:8080"
	c.Session.KeyTTLSeconds = 900
	c.Crypt.Argon2.Time = 3
	c.Crypt.Argon2.MemoryKiB = 65536
	c.Crypt.Argon2.Threads = 4
	d := yaml.NewDecoder(r)
	d.KnownFields(true)
	// YAML errors can contain secret values. Never return the original decoder error.
	if err := d.Decode(c); err != nil {
		return nil, fmt.Errorf("配置 YAML 无效或包含未知字段")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("配置只能包含一个 YAML 文档")
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// Validate checks required fields and bounds expensive cryptographic parameters.
func (c *Config) Validate() error {
	if _, err := logging.ParseLevel(c.Logging.Level); err != nil {
		return err
	}
	c.Logging.Level = strings.ToLower(strings.TrimSpace(c.Logging.Level))
	if c.Index.CheckIntervalSeconds < 1 {
		return fmt.Errorf("index.check_interval_seconds 必须大于 0")
	}
	required := []struct{ name, value string }{
		{"server.listen", c.Server.Listen}, {"server.access_token", c.Server.AccessToken},
		{"openlist.base_url", c.OpenList.BaseURL}, {"openlist.username", c.OpenList.Username}, {"openlist.password", c.OpenList.Password},
		{"openlist.cipher_backend_path", c.OpenList.CipherBackendPath},
		{"crypt.password", c.Crypt.Password}, {"crypt.salt_base64", c.Crypt.SaltBase64},
	}
	for _, f := range required {
		if strings.TrimSpace(f.value) == "" {
			return fmt.Errorf("缺少必填项: %s", f.name)
		}
	}
	if len(c.Server.AccessToken) < 32 {
		return fmt.Errorf("server.access_token 至少需要 32 字节")
	}
	if _, _, err := net.SplitHostPort(c.Server.Listen); err != nil {
		return fmt.Errorf("server.listen 无效")
	}
	if c.Server.BasePath != "" && (c.Server.BasePath[0] != '/' || c.Server.BasePath == "/" || path.Clean(c.Server.BasePath) != c.Server.BasePath || strings.ContainsAny(c.Server.BasePath, "?#\\")) {
		return fmt.Errorf("server.base_path 必须为空或规范的绝对子路径，例如 /frame")
	}
	u, err := url.Parse(c.OpenList.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("openlist.base_url 无效")
	}
	c.OpenList.BaseURL = strings.TrimRight(c.OpenList.BaseURL, "/")
	backend := c.OpenList.CipherBackendPath
	if backend == "/" || !strings.HasPrefix(backend, "/") || path.Clean(backend) != backend || strings.ContainsAny(backend, "\\\x00") {
		return fmt.Errorf("openlist.cipher_backend_path 必须是非根目录的规范绝对路径")
	}
	if _, err := c.Salt(); err != nil {
		return err
	}
	a := c.Crypt.Argon2
	if a.Time < 1 || a.Time > 20 || a.Threads < 1 || a.Threads > 64 || a.MemoryKiB < 8*uint32(a.Threads) || a.MemoryKiB > 1048576 {
		return fmt.Errorf("crypt.argon2 参数无效: time 1–20, threads 1–64, memory_kib 8*threads–1048576")
	}
	if c.Session.KeyTTLSeconds < 1 || c.Session.KeyTTLSeconds > 86400 {
		return fmt.Errorf("session.key_ttl_seconds 必须为 1–86400")
	}
	return nil
}

// Salt decodes the configured standard Base64 salt, with optional padding.
func (c *Config) Salt() ([]byte, error) {
	s, err := base64.StdEncoding.Strict().DecodeString(c.Crypt.SaltBase64)
	if err != nil {
		s, err = base64.RawStdEncoding.Strict().DecodeString(c.Crypt.SaltBase64)
	}
	if err != nil || len(s) == 0 {
		return nil, fmt.Errorf("crypt.salt_base64 必须是非空标准 Base64")
	}
	return s, nil
}

// DeriveKey derives the AES key once at startup. Config must be validated first.
func (c *Config) DeriveKey() []byte {
	salt, _ := c.Salt()
	a := c.Crypt.Argon2
	return argon2.IDKey([]byte(c.Crypt.Password), salt, a.Time, a.MemoryKiB, a.Threads, 32)
}
