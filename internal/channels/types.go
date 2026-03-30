package channels

type Identity struct {
	Key string
}

type Channel struct {
	ID          string
	SourceIndex int
	Identity    Identity
	TVGID       string
	Number      string
	Name        string
	LogoURL     string
	GroupTitle  string
	StreamURL   string
}
