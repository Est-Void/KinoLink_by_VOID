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

// Wikidata properties mapping external ids to IMDb ids.
var (
	tmdbMovieProp  = "P4947"
	tmdbSeriesProp = "P4983"
	netflixProp    = "P1874" // "Netflix ID" — identifier for a creative work
)

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

// queryImdbMapping runs one SPARQL query and returns the first IMDb id found.
func queryImdbMapping(ctx context.Context, client *http.Client, endpoint, sparql string) (string, error) {
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
		return "", err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("sparql status %d", resp.StatusCode)
	}
	var parsed sparqlResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	for _, binding := range parsed.Results.Bindings {
		if id := strings.TrimSpace(binding.Imdb.Value); id != "" {
			return id, nil
		}
	}
	return "", fmt.Errorf("no imdb mapping")
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
		if id, err := queryImdbMapping(ctx, client, endpoint, sparql); err == nil {
			return id, nil
		}
	}
	return "", fmt.Errorf("no imdb mapping for tmdb %s", tmdbID)
}

// resolveImdbFromNetflix maps a Netflix title id to an IMDb id via Wikidata
// (P1874 -> P345). The id must be pre-validated by pickID (digits only), so it
// is safe to embed into the SPARQL literal.
func resolveImdbFromNetflix(ctx context.Context, client *http.Client, endpoint, netflixID string) (string, error) {
	sparql := fmt.Sprintf(
		`SELECT ?imdb WHERE { ?item wdt:%s "%s" . ?item wdt:P345 ?imdb . }`,
		netflixProp, netflixID,
	)
	id, err := queryImdbMapping(ctx, client, endpoint, sparql)
	if err != nil {
		return "", fmt.Errorf("no imdb mapping for netflix %s: %w", netflixID, err)
	}
	return id, nil
}
