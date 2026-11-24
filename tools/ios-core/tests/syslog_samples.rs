use ios_core::{parse_envelope, EncodingStatus, SemanticLevel};

#[test]
fn parses_raw_json_envelope() {
    let line = include_str!("../../ios-probe/samples/syslog-unity.jsonl")
        .lines()
        .nth(1)
        .expect("sample line");
    let record = parse_envelope(line).expect("record");
    assert_eq!(record.device, "Test-iPhone");
    assert_eq!(record.process, "FruitQuest");
    assert_eq!(record.module.as_deref(), Some("Foundation"));
    assert_eq!(record.level, "error");
    assert_eq!(record.semantic_level, None);
    assert_eq!(record.message, "simulated error");
}

#[test]
fn parses_sanitized_capability_samples() {
    let records: Vec<_> = include_str!("../../ios-probe/samples/syslog-unity-capabilities.jsonl")
        .lines()
        .filter_map(parse_envelope)
        .collect();
    assert_eq!(records.len(), 8);
    assert_eq!(records[0].semantic_level, Some(SemanticLevel::Info));
    assert_eq!(records[1].semantic_level, Some(SemanticLevel::Warning));
    assert_eq!(records[2].semantic_level, Some(SemanticLevel::Error));
    assert_eq!(records[3].semantic_level, Some(SemanticLevel::Exception));
    assert_eq!(
        records[4].encoding_status,
        EncodingStatus::SuspectedMojibake
    );
    assert_eq!(records[5].semantic_level, None);
    assert_eq!(records[6].semantic_level, None);
    assert!(records[7].truncated);
}
