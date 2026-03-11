import json
from pathlib import Path
import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'data' / 'Telco-Customer-Churn.csv' 
MODEL_DIR = ROOT / 'ml' / 'model'
MODEL_PATH = MODEL_DIR / 'churn_model.joblib'


def engineer_features(df: pd.DataFrame, monthly_median: float) -> pd.DataFrame:
    df = df.copy()

    df['ChargesPerTenure'] = df['TotalCharges'] / (df['tenure'] + 1)
    df['IsNewCustomer'] = (df['tenure'] <= 6).astype(int)
    df['IsLongTermCustomer'] = (df['tenure'] >= 24).astype(int)

    service_cols = [
        'PhoneService', 'MultipleLines', 'OnlineSecurity', 'OnlineBackup',
        'DeviceProtection', 'TechSupport', 'StreamingTV', 'StreamingMovies',
    ]
    df['NumServices'] = df[service_cols].apply(lambda row: (row == 'Yes').sum(), axis=1)
    df['HasInternet'] = (df['InternetService'] != 'No').astype(int)

    df['EasyLeaver'] = (
        (df['PaperlessBilling'] == 'Yes') &
        (df['PaymentMethod'] == 'Electronic check')
    ).astype(int)

    df['FiberNoAddons'] = (
        (df['InternetService'] == 'Fiber optic') &
        (df['OnlineSecurity'] == 'No') &
        (df['OnlineBackup'] == 'No') &
        (df['DeviceProtection'] == 'No')
    ).astype(int)

    df['SoloCustomer'] = (
        (df['Partner'] == 'No') &
        (df['Dependents'] == 'No')
    ).astype(int)

    df['NoProtection'] = (
        (df['OnlineSecurity'] == 'No') &
        (df['OnlineBackup'] == 'No') &
        (df['TechSupport'] == 'No')
    ).astype(int)

    df['HighRiskCombo'] = (
        (df['Contract'] == 'Month-to-month') &
        (df['MonthlyCharges'] > monthly_median)
    ).astype(int)

    return df


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f'Dataset not found at: {DATA_PATH}. '
            'Place Telco-Customer-Churn.csv in the data/ folder before training.'
        )

    df = pd.read_csv(DATA_PATH)

    df['TotalCharges'] = pd.to_numeric(df['TotalCharges'], errors='coerce')
    df = df.dropna(subset=['TotalCharges']).reset_index(drop=True)

    monthly_median = float(df['MonthlyCharges'].median())
    df = engineer_features(df, monthly_median)

    if 'customerID' in df.columns:
        df = df.drop(columns=['customerID'])

    y = df['Churn'].map({'Yes': 1, 'No': 0})
    X = df.drop(columns=['Churn'])

    categorical_cols = X.select_dtypes(include='object').columns.tolist()
    numerical_cols   = X.select_dtypes(exclude='object').columns.tolist()

    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numerical_cols),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical_cols),
        ]
    )

    preprocessor.fit(X)
    X_transformed = preprocessor.transform(X)

    sample_weights = compute_sample_weight('balanced', y)

    model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=4,
        random_state=42,
    )
    model.fit(X_transformed, y, sample_weight=sample_weights)

    # ── Build feature importance map from the actual model ──────────────
    feature_names = preprocessor.get_feature_names_out()   # all OHE + scaled names
    raw_importances = model.feature_importances_           # from GradientBoosting

    # Roll OHE columns back to original column names for readability
    # e.g. "cat__Contract_Month-to-month" → "Contract"
    importance_map = {}
    for fname, imp in zip(feature_names, raw_importances):
        # Strip sklearn prefixes added by ColumnTransformer
        clean = fname.replace('num__', '').replace('cat__', '')
        # Group OHE dummies back to their parent column
        original_col = clean.split('_')[0] if '__' not in fname else clean.split('_')[0]
        importance_map[original_col] = importance_map.get(original_col, 0.0) + float(imp)

    # Normalise to 0–100
    max_imp = max(importance_map.values()) if importance_map else 1.0
    importance_map = {
        k: round((v / max_imp) * 100, 1)
        for k, v in sorted(importance_map.items(), key=lambda x: x[1], reverse=True)
    }
    # ────────────────────────────────────────────────────────────────────

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    artifact = {
        'model':            model,
        'preprocessor':     preprocessor,
        'monthly_median':   monthly_median,
        'columns':          X.columns.tolist(),
        'importance_map':   importance_map,  
    }

    joblib.dump(artifact, MODEL_PATH)

    print(json.dumps({
        'status':       'ok',
        'model_path':   str(MODEL_PATH),
        'rows':         int(len(df)),
        'top_features': list(importance_map.items())[:10],   # logged for info
    }))


if __name__ == '__main__':
    main()