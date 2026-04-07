.PHONY: cli landing-page-demo publish

DEMO_REPO ?= /tmp/argus-demo-turkish

# Makes the argus cli available locally.
# On fish shell do: 
#     eval (make -s cli)
cli:
	@printf "alias argus='pnpm --dir \"%s\" exec node --import tsx \"%s/cli/index.ts\"'\n" "$(CURDIR)" "$(CURDIR)"

landing-page-demo:
	pnpm landing-page:demo -- \
		--repo "$(DEMO_REPO)" \
		--default-branch origin/main \
		--title "xplosunn/argus-demo-turkish#1"

publish:
	npm login && npm publish --access public
