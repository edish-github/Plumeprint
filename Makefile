.PHONY: data check test clean fresh
data:      ## run the whole pipeline
	python -m pipeline.cli all
check:     ## acceptance checks only
	python -m pipeline.cli check
test:      ## unit tests
	python -m pytest -q
clean:     ## drop derived data, keep the raw cache
	rm -rf data/interim web/public/data
fresh:     ## drop everything including the raw cache (slow to rebuild)
	rm -rf data/interim data/raw web/public/data
