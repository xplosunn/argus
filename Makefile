.PHONY: cli landing-page-demo publish

# Makes the argus cli available locally.
# On fish shell do: 
#     eval (make -s cli)
cli:
	@printf "alias argus='pnpm --dir \"%s\" exec node --import tsx \"%s/cli/index.ts\"'\n" "$(CURDIR)" "$(CURDIR)"

landing-page-demo:
	rm -rf /tmp/argus-demo-turkish && \
	git clone git@github.com:xplosunn/argus-demo-turkish.git /tmp/argus-demo-turkish && \
	cd /tmp/argus-demo-turkish && \
	git switch incompatible-array-type-bug && \
	cd - && \
	pnpm landing-page:demo -- \
		--repo /tmp/argus-demo-turkish \
		--default-branch origin/main \
		--title "xplosunn/argus-demo-turkish#1"

publish:
	npm login && npm publish --access public
