package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func main() {
	filePath := flag.String("file", "VERSION", "path to the version file")
	releaseType := flag.String("release", "minor", "release type to bump")
	flag.Parse()

	if *releaseType != "minor" {
		fmt.Fprintf(os.Stderr, "unsupported release type %q\n", *releaseType)
		os.Exit(1)
	}

	version, err := readVersion(*filePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	version.minor++
	version.patch = 0

	if err := os.WriteFile(*filePath, []byte(version.String()+"\n"), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write version file: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(version.String())
}

type semver struct {
	major int
	minor int
	patch int
}

func (v semver) String() string {
	return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
}

func readVersion(filePath string) (semver, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return semver{}, fmt.Errorf("read version file: %w", err)
	}

	parts := strings.Split(strings.TrimSpace(string(raw)), ".")
	if len(parts) != 3 {
		return semver{}, fmt.Errorf("invalid semantic version in %s", filePath)
	}

	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return semver{}, fmt.Errorf("parse major version: %w", err)
	}

	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return semver{}, fmt.Errorf("parse minor version: %w", err)
	}

	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return semver{}, fmt.Errorf("parse patch version: %w", err)
	}

	return semver{
		major: major,
		minor: minor,
		patch: patch,
	}, nil
}
