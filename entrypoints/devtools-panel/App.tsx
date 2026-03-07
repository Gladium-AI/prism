import { CookieSection } from './components/CookieSection';
import { EndpointDetails } from './components/EndpointDetails';
import { EndpointList } from './components/EndpointList';
import { PanelToolbar } from './components/PanelToolbar';
import { usePanelController } from './usePanelController';

function App() {
  const controller = usePanelController();

  return (
    <main className="panel-root">
      <PanelToolbar
        isSnapshot={controller.isSnapshot}
        isCapturingCookies={controller.isCapturingCookies}
        snapshotTime={controller.snapshotTime}
        statusOverride={controller.statusOverride}
        onSnapshotToggle={controller.toggleSnapshot}
        onExportSnapshot={controller.exportSnapshot}
        onExportMap={controller.exportMap}
        canExportSnapshot={controller.isSnapshot}
        canExportMap={controller.checkedCount > 0 && !controller.isExportingMap}
        isExportingMap={controller.isExportingMap}
        aiSettings={controller.aiSettings}
        isAISettingsLoaded={controller.isAISettingsLoaded}
        aiProgress={controller.aiProgress}
        onSetAIProvider={controller.setAIProvider}
        onSetAIEnrichmentEnabled={controller.setAIEnrichmentEnabled}
        onSetAIApiKey={controller.setAIApiKeyForProvider}
      />

      <section className="panel-grid" aria-label="Prism API map">
        <EndpointList
          groups={controller.groups}
          requestCount={controller.displayEntries.length}
          selectedEndpointKey={controller.selectedEndpointKey}
          checkedEndpointKeys={controller.checkedEndpointKeys}
          collapsedSections={controller.collapsedSections}
          mergedSchemaByKey={controller.mergedSchemaByKey}
          onSelectEndpoint={controller.setSelectedEndpointKey}
          onToggleChecked={(endpointKey, checked) => {
            controller.setCheckedEndpointKeys((previous) => ({
              ...previous,
              [endpointKey]: checked,
            }));
          }}
          onToggleSection={(sectionKey) => {
            controller.setCollapsedSections((previous) => ({
              ...previous,
              [sectionKey]: !previous[sectionKey],
            }));
          }}
          onSelectAll={controller.selectAll}
          onSelectNone={controller.selectNone}
        />

        <article className="pane detail-pane" aria-label="Endpoint details">
          <EndpointDetails
            group={controller.selectedGroup}
            mergedSchema={controller.selectedMergedSchema}
          />
          <CookieSection
            isSnapshot={controller.isSnapshot}
            isCapturingCookies={controller.isCapturingCookies}
            snapshotCookies={controller.snapshotCookies}
            snapshotCookieDomain={controller.snapshotCookieDomain}
            snapshotCookieError={controller.snapshotCookieError}
          />
        </article>
      </section>
    </main>
  );
}

export default App;
