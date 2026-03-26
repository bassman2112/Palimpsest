.PHONY: run build check clean release test

run:
	npm run tauri dev

build:
	npm run tauri build

check:
	npx tsc --noEmit
	cd src-tauri && ~/.cargo/bin/cargo check

clean:
	rm -rf dist
	cd src-tauri && ~/.cargo/bin/cargo clean

test:
	npx vitest run
	cd src-tauri && ~/.cargo/bin/cargo test

# Cut a release: make release VERSION=0.2.0
release:
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=0.2.0)
endif
	@echo "Releasing v$(VERSION)..."
	sed -i '' 's/"version": ".*"/"version": "$(VERSION)"/' package.json
	sed -i '' 's/^version = ".*"/version = "$(VERSION)"/' src-tauri/Cargo.toml
	sed -i '' 's/"version": ".*"/"version": "$(VERSION)"/' src-tauri/tauri.conf.json
	git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
	git commit -m "release: v$(VERSION)"
	git tag "v$(VERSION)"
	git push origin main --tags
	@echo "Pushed v$(VERSION) — GitHub Actions will build the release."
