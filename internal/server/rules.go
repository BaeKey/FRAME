package server

import (
	"encoding/json"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/BaeKey/FRAME/internal/catalog"
)

type ruleInput struct {
	Rules    []catalog.NamingRule `json:"rules"`
	Filename string               `json:"filename"`
}

func readRules(w http.ResponseWriter, r *http.Request) (ruleInput, bool) {
	var input ruleInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		fail(w, 400, "规则请求格式无效")
		return input, false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "规则请求只能包含一个 JSON 对象")
		return input, false
	}
	if input.Rules == nil {
		input.Rules = []catalog.NamingRule{}
	}
	return input, true
}

func (s *server) namingRules(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"rules": s.catalog.NamingRules()})
}
func (s *server) previewNamingRules(w http.ResponseWriter, r *http.Request) {
	input, ok := readRules(w, r)
	if !ok {
		return
	}
	if input.Filename == "" || len(input.Filename) > 1024 || path.Base(input.Filename) != input.Filename || strings.ContainsAny(input.Filename, "\\\x00") {
		fail(w, 400, "请输入文件名，不含目录")
		return
	}
	item, err := catalog.PreviewNaming(input.Rules, input.Filename)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"group": item.User, "timestamp": item.Timestamp, "type": item.Type, "matched": item.User != catalog.OtherGroup})
}
