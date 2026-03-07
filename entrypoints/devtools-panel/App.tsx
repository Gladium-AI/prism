import { PanelToolbar } from './components/PanelToolbar';
import { DashboardTab, MappingTreeTab, PANEL_TABS, SequenceFlowTab, type PanelTabId } from './components/TabbedViews';
import { useState } from 'react';
import { usePanelController } from './usePanelController';

function App() {
  const controller = usePanelController();
  const [activeTab, setActiveTab] = useState<PanelTabId>('dashboard');

  return (
    <main className="panel-root">
      <div className="panel-top-chrome">
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
          noiseFilterSettings={controller.noiseFilterSettings}
          aiProgress={controller.aiProgress}
          onSetAIProvider={controller.setAIProvider}
          onSetAIEnrichmentEnabled={controller.setAIEnrichmentEnabled}
          onSetAIApiKey={controller.setAIApiKeyForProvider}
          onSetNoiseFilterEnabled={controller.setNoiseFilterEnabled}
          onApplyNoiseFilterSettings={controller.applyNoiseFilterSettings}
        />

        <nav className="panel-tab-nav" aria-label="Prism panel views">
          {PANEL_TABS.map((tab) => (
            <button
              className={`panel-tab-button${activeTab === tab.id ? ' active' : ''}`}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id ? 'true' : 'false'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <section className="panel-content" aria-label="Prism API map">
        {activeTab === 'dashboard' ? (
          <DashboardTab
            groups={controller.groups}
            displayEntries={controller.displayEntries}
            selectedEndpointKey={controller.selectedEndpointKey}
            checkedEndpointKeys={controller.checkedEndpointKeys}
            collapsedSections={controller.collapsedSections}
            mergedSchemaByKey={controller.mergedSchemaByKey}
            graphQLOperationByKey={controller.graphQLOperationByKey}
            selectedGroup={controller.selectedGroup}
            selectedMergedSchema={controller.selectedMergedSchema}
            selectedGraphQLOperation={controller.selectedGraphQLOperation}
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
        ) : null}

        {activeTab === 'mapping-tree' ? (
          <MappingTreeTab
            groups={controller.groups}
            displayEntries={controller.displayEntries}
            selectedEndpointKey={controller.selectedEndpointKey}
            checkedEndpointKeys={controller.checkedEndpointKeys}
            mergedSchemaByKey={controller.mergedSchemaByKey}
            graphQLOperationByKey={controller.graphQLOperationByKey}
            selectedGroup={controller.selectedGroup}
            selectedMergedSchema={controller.selectedMergedSchema}
            selectedGraphQLOperation={controller.selectedGraphQLOperation}
            onSelectEndpoint={controller.setSelectedEndpointKey}
            onToggleChecked={(endpointKey, checked) => {
              controller.setCheckedEndpointKeys((previous) => ({
                ...previous,
                [endpointKey]: checked,
              }));
            }}
            onSetBranchChecked={(endpointKeys, checked) => {
              controller.setCheckedEndpointKeys((previous) => {
                const next = { ...previous };
                for (const endpointKey of endpointKeys) {
                  next[endpointKey] = checked;
                }
                return next;
              });
            }}
            onSelectAll={controller.selectAll}
            onSelectNone={controller.selectNone}
          />
        ) : null}

        {activeTab === 'sequence-flow' ? (
          <SequenceFlowTab
            groups={controller.groups}
            displayEntries={controller.displayEntries}
            onSelectEndpoint={controller.setSelectedEndpointKey}
          />
        ) : null}
      </section>
    </main>
  );
}

export default App;
