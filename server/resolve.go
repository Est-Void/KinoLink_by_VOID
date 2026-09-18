package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Wikidata properties mapping TMDB ids to IMDb ids.
var tmdbMovieProp = "P4947"
var tmdbSeriesProp = "P4983"

const wikidataSparqlEndpoint = "https://query.wikidata.org/bigdata/namespace/wdq/sparql"

type sparqlResponse struct {
	Results struct {
		Bindings []struct {
			Imdb struct {
				Value string `json:"value"`
			} `json:"imdb"`
		} `json:"bindings"`
	} `json:"results"`
}

// resolveImdbFromTmdb maps a TMDB movie/series id to an IMDb id via Wikidata.
// seriesFirst flips the property order: TMDB reuses numeric ids across movies
// and series, so "movie first" can resolve a series to the wrong title.
func resolveImdbFromTmdb(ctx context.Context, client *http.Client, endpoint, tmdbID string, seriesFirst bool) (string, error) {
	props := []string{tmdbMovieProp, tmdbSeriesProp}
	if seriesFirst {
		props = []string{tmdbSeriesProp, tmdbMovieProp}
	}
	for _, prop := range props {
		sparql := fmt.Sprintf(
			`SELECT ?imdb WHERE { ?item wdt:%s "%s" . ?item wdt:P345 ?imdb . }`,
			prop, tmdbID,
		)
		u, err := url.Parse(endpoint)
		if err != nil {
			return "", err
		}
		q := u.Query()
		q.Set("query", sparql)
		q.Set("format", "json")
		u.RawQuery = q.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("Accept", "application/sparql-results+json")
		req.Header.Set("User-Agent", "kinolink/2.0")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		if err != nil || resp.StatusCode != http.StatusOK {
			continue
		}
		var parsed sparqlResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			continue
		}
		for _, binding := range parsed.Results.Bindings {
			if id := strings.TrimSpace(binding.Imdb.Value); id != "" {
				return id, nil
			}
		}
	}
	return "", fmt.Errorf("no imdb mapping for tmdb %s", tmdbID)
}
