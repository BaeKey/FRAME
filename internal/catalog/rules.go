package catalog

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

const OtherGroup = "其他"

type NamingRule struct {
	Name     string `json:"name"`
	Template string `json:"template"`
	Enabled  bool   `json:"enabled"`
}

type compiledRule struct {
	rule    NamingRule
	pattern *regexp.Regexp
}

func DefaultRules() []NamingRule {
	return []NamingRule{{Name: "用户与时间", Template: "{group}_{date}-{time}.{ext}", Enabled: true}}
}

// Templates are escaped literals plus a small fixed token vocabulary, not arbitrary regex.
// {date}=YYYYMMDD and {time}=HHmmss are interpreted in Asia/Shanghai.
func compileRules(rules []NamingRule) ([]compiledRule, error) {
	if len(rules) > 20 {
		return nil, errors.New("最多配置 20 套命名规则")
	}
	out := []compiledRule{}
	for _, rule := range rules {
		if strings.TrimSpace(rule.Name) == "" || len(rule.Name) > 100 || len(rule.Template) == 0 || len(rule.Template) > 256 {
			return nil, errors.New("规则名称不能为空且不超过 100 字节，模板须为 1–256 字节")
		}
		seen := map[string]bool{}
		var pattern strings.Builder
		pattern.WriteString("^")
		for text := rule.Template; text != ""; {
			i := strings.IndexByte(text, '{')
			if i < 0 {
				if strings.Contains(text, "}") {
					return nil, errors.New("模板括号不匹配")
				}
				pattern.WriteString(regexp.QuoteMeta(text))
				break
			}
			literal := text[:i]
			if strings.Contains(literal, "}") {
				return nil, errors.New("模板括号不匹配")
			}
			pattern.WriteString(regexp.QuoteMeta(literal))
			text = text[i+1:]
			end := strings.IndexByte(text, '}')
			if end < 0 {
				return nil, errors.New("模板括号不匹配")
			}
			token := text[:end]
			text = text[end+1:]
			if seen[token] {
				return nil, errors.New("模板中的占位符不能重复")
			}
			seen[token] = true
			switch token {
			case "group":
				pattern.WriteString(`(?P<group>.+)`)
			case "date":
				pattern.WriteString(`(?P<date>\d{8})`)
			case "time":
				pattern.WriteString(`(?P<time>\d{6})`)
			case "ext":
				pattern.WriteString(`(?P<ext>[^.]+)`)
			case "name":
				pattern.WriteString(`(?P<name>.+)`)
			default:
				return nil, errors.New("仅支持 {group}、{date}、{time}、{ext}、{name} 占位符")
			}
			if strings.HasPrefix(text, "{") {
				return nil, errors.New("占位符之间须有固定分隔符")
			}
		}
		if !seen["group"] || !seen["ext"] || (seen["time"] && !seen["date"]) || strings.ContainsAny(rule.Template, "/\\\x00\n\r") {
			return nil, errors.New("模板必须包含 {group} 和 {ext}；{time} 需要 {date}；不能包含路径分隔符")
		}
		pattern.WriteString("$")
		re, err := regexp.Compile(pattern.String())
		if err != nil {
			return nil, errors.New("命名模板无效")
		}
		if rule.Enabled {
			out = append(out, compiledRule{rule: rule, pattern: re})
		}
	}
	return out, nil
}

func classify(name string, rules []compiledRule) (group, timestamp string) {
	for _, rule := range rules {
		match := rule.pattern.FindStringSubmatch(name)
		if match == nil {
			continue
		}
		get := func(key string) string {
			i := rule.pattern.SubexpIndex(key)
			if i < 0 {
				return ""
			}
			return match[i]
		}
		group = strings.TrimSpace(get("group"))
		if group == "" || group == OtherGroup {
			continue
		}
		date, clock := get("date"), get("time")
		if date != "" {
			if clock == "" {
				clock = "000000"
			}
			at, err := time.ParseInLocation("20060102150405", date+clock, localZone)
			if err != nil {
				continue
			}
			timestamp = at.Format(time.RFC3339)
		}
		return group, timestamp
	}
	return OtherGroup, ""
}
